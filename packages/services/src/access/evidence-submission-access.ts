import { desc, eq } from 'drizzle-orm';
import { orgGrantPermits } from '../agency';
import { type Db, first, schema } from '../db';
import {
  evidenceSubmissionsPresent,
  newerUnlinkedDecision,
  pinnedVersionIntact,
} from '../evidence-submission-tables';
import { isUuid } from '../lifecycle/foundation/ids';
import { getOrganization, isOrgAdmin } from '../organizations';

/**
 * Lane D: the one definition of "this sent copy may be opened by the agency right now", and the
 * replay of that decision when a file link is redeemed.
 *
 * A traveller's answer to an evidence request is pinned to one exact document version
 * (`evidence_request_submissions`). The agency reads bytes of that version only while the agency
 * still holds its standing (an active OWNER or ADMIN of an active organization with a current
 * MANAGE grant covering the request) AND the copy is either the one waiting for a decision or the
 * one that was accepted. A copy the agency sent back, an older send that a newer one replaced, or
 * the copy of a withdrawn request is never served again. Nothing here ever falls back to "the
 * document's latest version".
 *
 * Lives in access/ beside the other gate decisions, like `collectionResponseStillCovers`.
 */

const PURPOSE_PREFIX = 'evidence_submission:';

/** The purpose a file link for one send carries; redemption reads the send back out of it. */
export function evidenceSubmissionPurpose(submissionId: string): string {
  return `${PURPOSE_PREFIX}${submissionId}`;
}

/** The send a link's purpose names, or undefined when it names none (or something malformed). */
export function submissionIdFromPurpose(purpose: string): string | undefined {
  if (!purpose.startsWith(PURPOSE_PREFIX)) return undefined;
  const id = purpose.slice(PURPOSE_PREFIX.length);
  return isUuid(id) ? id : undefined;
}

type SubmissionRow = typeof schema.evidenceRequestSubmissions.$inferSelect;

export type SubmissionServing =
  | { readonly serves: true; readonly state: 'AWAITING_DECISION' | 'ACCEPTED' }
  | { readonly serves: false; readonly reason: string };

/**
 * Whether bytes of this send may be served at all, from the request's live state:
 * - decided: only an ACCEPTED decision on this very send, while the request stays ACCEPTED;
 * - undecided: only the newest send of a request that is still waiting for a decision.
 */
export async function evidenceSubmissionServing(
  db: Db,
  submission: Pick<SubmissionRow, 'id' | 'evidenceRequestId' | 'documentId' | 'roundNo' | 'sentAt'>,
): Promise<SubmissionServing> {
  const request = first(
    await db
      .select({
        status: schema.evidenceRequests.status,
        respondingDocumentId: schema.evidenceRequests.respondingDocumentId,
      })
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, submission.evidenceRequestId))
      .limit(1),
  );
  if (!request) return { serves: false, reason: 'request_missing' };
  const link = first(
    await db
      .select({ outcome: schema.evidenceRequestDecisions.outcome })
      .from(schema.evidenceRequestDecisionSubmissions)
      .innerJoin(
        schema.evidenceRequestDecisions,
        eq(
          schema.evidenceRequestDecisions.id,
          schema.evidenceRequestDecisionSubmissions.decisionId,
        ),
      )
      .where(eq(schema.evidenceRequestDecisionSubmissions.submissionId, submission.id))
      .limit(1),
  );
  if (link) {
    return link.outcome === 'ACCEPTED' && request.status === 'ACCEPTED'
      ? { serves: true, state: 'ACCEPTED' }
      : { serves: false, reason: 'decided_not_accepted' };
  }
  if (request.status !== 'RECEIVED' && request.status !== 'UNDER_REVIEW') {
    return { serves: false, reason: 'request_not_awaiting_decision' };
  }
  // An older deployment running beside this one may have decided the request without a link.
  if (await newerUnlinkedDecision(db, submission.evidenceRequestId, submission.sentAt)) {
    return { serves: false, reason: 'decided_without_link' };
  }
  const newest = first(
    await db
      .select({ id: schema.evidenceRequestSubmissions.id })
      .from(schema.evidenceRequestSubmissions)
      .where(eq(schema.evidenceRequestSubmissions.evidenceRequestId, submission.evidenceRequestId))
      .orderBy(desc(schema.evidenceRequestSubmissions.roundNo))
      .limit(1),
  );
  if (newest?.id !== submission.id) return { serves: false, reason: 'replaced_by_newer_send' };
  if (request.respondingDocumentId !== submission.documentId) {
    return { serves: false, reason: 'request_points_elsewhere' };
  }
  return { serves: true, state: 'AWAITING_DECISION' };
}

export type EvidenceSubmissionCoverage =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Re-checked when a send's file link is opened (the serving route, through
 * `recheckDocumentAccess`), against live state only: the account is still an active OWNER or ADMIN
 * of the organization that asked, the organization is active and still holds a MANAGE grant for the
 * request, the send is the one the request still serves, and the pinned version is still the same
 * stored object with the same checksum. Anything else is refused with a reason that is logged,
 * never shown.
 */
export async function evidenceSubmissionStillCovers(
  db: Db,
  fields: {
    readonly submissionId: string;
    readonly accountId: string;
    readonly organizationId: string;
    readonly documentId: string;
    readonly documentVersionId: string;
  },
): Promise<EvidenceSubmissionCoverage> {
  const ids = [
    fields.submissionId,
    fields.accountId,
    fields.organizationId,
    fields.documentId,
    fields.documentVersionId,
  ];
  if (!ids.every(isUuid)) return { allowed: false, reason: 'malformed' };
  if (!(await evidenceSubmissionsPresent(db))) return { allowed: false, reason: 'not_migrated' };
  if (!(await isOrgAdmin(db, fields.accountId, fields.organizationId))) {
    return { allowed: false, reason: 'not_an_agency_admin' };
  }
  const organization = await getOrganization(db, fields.organizationId);
  if (!organization || organization.status !== 'ACTIVE') {
    return { allowed: false, reason: 'organization_not_active' };
  }
  const submission = first(
    await db
      .select()
      .from(schema.evidenceRequestSubmissions)
      .where(eq(schema.evidenceRequestSubmissions.id, fields.submissionId))
      .limit(1),
  );
  if (
    !submission ||
    submission.documentId !== fields.documentId ||
    submission.documentVersionId !== fields.documentVersionId
  ) {
    return { allowed: false, reason: 'not_this_send' };
  }
  const request = first(
    await db
      .select({
        organizationId: schema.evidenceRequests.organizationId,
        applicantId: schema.evidenceRequests.applicantId,
        missionId: schema.evidenceRequests.missionId,
      })
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, submission.evidenceRequestId))
      .limit(1),
  );
  if (!request || request.organizationId !== fields.organizationId) {
    return { allowed: false, reason: 'not_this_organizations_request' };
  }
  if (
    !(await orgGrantPermits(
      db,
      request.organizationId,
      request.applicantId,
      'MANAGE',
      request.missionId ?? undefined,
    ))
  ) {
    return { allowed: false, reason: 'no_current_grant' };
  }
  const serving = await evidenceSubmissionServing(db, submission);
  if (!serving.serves) return { allowed: false, reason: serving.reason };
  const version = first(
    await db
      .select({
        documentId: schema.documentVersions.documentId,
        storageObjectId: schema.documentVersions.storageObjectId,
        sha256: schema.documentVersions.sha256,
      })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, submission.documentVersionId))
      .limit(1),
  );
  if (!version || !pinnedVersionIntact(submission, version)) {
    return { allowed: false, reason: 'pinned_version_changed' };
  }
  return { allowed: true };
}
