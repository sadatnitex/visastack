import { type Result, err, ok } from '@visastack/core';
import { and, asc, eq } from 'drizzle-orm';
import { evidenceSubmissionServing } from './access/evidence-submission-access';
import type { AuthorizedApplicant } from './access/require-access';
import { StepUpProof } from './access/step-up-proof';
import { orgGrantPermits } from './agency';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { isDocumentVersionUsable, issueEvidenceSubmissionReadRef } from './documents';
import { hasActiveOrVerifiedErasureJob } from './erasure';
import { type ServiceError, keyedError, serviceError } from './errors';
import {
  evidenceSubmissionsPresent,
  newerUnlinkedDecision,
  pinnedVersionIntact,
} from './evidence-submission-tables';
import { lifecycleTablesPresent, presentDocumentCondition } from './lifecycle/foundation';
import { isUuid } from './lifecycle/foundation/ids';
import { isOrgAdmin } from './organizations';
import type { AccessRef, StoragePort } from './storage';

export { evidenceSubmissionsPresent } from './evidence-submission-tables';

/**
 * Lane D: the exact copies a traveller sent in answer to evidence requests, and the one way an
 * agency opens such a copy.
 *
 * - `submitEvidenceResponse` and `decideEvidenceResponse` (agency.ts) write the records.
 * - `listEvidenceSubmissions` shows them: the traveller sees what they sent, the agency sees what
 *   was sent to it. Only safe facts about a copy leave here (kind, version number, size, a short
 *   checksum fingerprint, times, the state), never a storage key, address or file content.
 * - `downloadEvidenceSubmissionFile` serves the original of one pinned copy to the agency: only
 *   while the agency still holds its standing and the copy is the one waiting for a decision or the
 *   one that was accepted, only with a recent identity confirmation, never a preview (ADR 0022
 *   decision 6), never the document's latest version.
 *
 * Both take the central access proof (`requireAccess`) for MANAGE, and re-check, from live state,
 * that the caller is this request's own traveller or this request's own agency.
 */

/** Shown wherever a send made before exact copies were kept is listed. */
export const LEGACY_SEND_LABEL = 'Sent before exact versions were kept';

export type EvidenceSubmissionState =
  | 'AWAITING_DECISION'
  | 'ACCEPTED'
  | 'NEEDS_REPLACEMENT'
  | 'CONTRADICTION'
  | 'CORRECTION_PROPOSED'
  /** The agency withdrew the request while this copy was still waiting. */
  | 'WITHDRAWN';

export interface EvidenceSubmissionView {
  readonly id: string;
  /** 1 for the first send on the request, then 2, 3 ... */
  readonly roundNo: number;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly versionNumber: number;
  /** The kind the file was filed as when it was sent. */
  readonly docType: string | null;
  /** The name the file had when it was sent. */
  readonly title: string;
  readonly sizeBytes: number | null;
  /** The first characters of the file's checksum, for telling two copies apart; null when none was recorded. */
  readonly checksumFingerprint: string | null;
  readonly sentAt: Date;
  readonly state: EvidenceSubmissionState;
  readonly decidedAt: Date | null;
  readonly reason: string | null;
  /** True when this agency may ask for the original right now (it still serves bytes); always false for the traveller. */
  readonly fileAvailable: boolean;
  /**
   * The pinned version's safety status right now, read live and never stored, for the scan note
   * (`loadVersionScanEvidence`). Null only if the version row is gone. No scanner name, no storage data.
   */
  readonly safetyStatus: (typeof schema.documentVersions.$inferSelect)['safetyStatus'] | null;
}

export interface LegacyEvidenceSend {
  readonly label: typeof LEGACY_SEND_LABEL;
  readonly documentId: string | null;
  readonly sentAt: Date | null;
  readonly state: Exclude<EvidenceSubmissionState, 'WITHDRAWN'>;
  readonly decidedAt: Date | null;
}

export interface EvidenceSubmissionList {
  /** False until migration 0132 ran: sends then keep no exact copy and nothing below is pinned. */
  readonly available: boolean;
  /** Oldest send first. */
  readonly submissions: readonly EvidenceSubmissionView[];
  /** Sends and decisions recorded without an exact copy, never described as pinned. */
  readonly legacy: readonly LegacyEvidenceSend[];
}

type EvidenceRequestRow = typeof schema.evidenceRequests.$inferSelect;

export interface EvidenceAudience {
  readonly request: EvidenceRequestRow;
  /** Present when the caller is the requesting agency. */
  readonly agency?: { readonly accountId: string; readonly organizationId: string };
}

/**
 * Who is asking, from the access proof and live state: the request's own traveller, or an active
 * OWNER or ADMIN of the organization that raised it, which still holds a current MANAGE grant for
 * it. Anyone else, and any request that does not exist, get the same "not found".
 */
export async function evidenceAudienceOf(
  access: AuthorizedApplicant<'MANAGE'>,
  requestId: string,
): Promise<Result<EvidenceAudience, ServiceError>> {
  const db = access.tx;
  const notFound = err(keyedError('not_found', 'evidence_submissions.evidence_request_not_found'));
  if (!isUuid(requestId)) return notFound;
  const request = first(
    await db
      .select()
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, requestId))
      .limit(1),
  );
  if (!request || request.applicantId !== access.applicant.id) return notFound;
  const actor = access.actor;
  if (actor.kind === 'applicant_owner') return ok({ request });
  if (actor.kind !== 'organization_member') return notFound;
  const organizationId = actor.membership.organizationId;
  if (organizationId !== request.organizationId) return notFound;
  if (!(await isOrgAdmin(db, actor.accountId, organizationId))) return notFound;
  if (
    !(await orgGrantPermits(
      db,
      organizationId,
      request.applicantId,
      'MANAGE',
      request.missionId ?? undefined,
    ))
  ) {
    return notFound;
  }
  return ok({ request, agency: { accountId: actor.accountId, organizationId } });
}

/**
 * Every send on one evidence request, oldest first, with the decision on each and a plain label
 * for anything recorded before exact copies were kept. Before migration 0132 (`available: false`)
 * only the older record is shown, labelled as such; nothing is described as an exact copy.
 */
export async function listEvidenceSubmissions(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly requestId: string },
): Promise<Result<EvidenceSubmissionList, ServiceError>> {
  const audience = await evidenceAudienceOf(access, input.requestId);
  if (!audience.ok) return audience;
  const { request, agency } = audience.value;
  const db = access.tx;
  // A fact is a value, not a file: nothing to keep a copy of.
  if (request.kind !== 'DOCUMENT') {
    return ok({ available: await evidenceSubmissionsPresent(db), submissions: [], legacy: [] });
  }
  const available = await evidenceSubmissionsPresent(db);

  const decisions = await db
    .select({
      id: schema.evidenceRequestDecisions.id,
      outcome: schema.evidenceRequestDecisions.outcome,
      reason: schema.evidenceRequestDecisions.reason,
      documentId: schema.evidenceRequestDecisions.respondingDocumentId,
      decidedAt: schema.evidenceRequestDecisions.createdAt,
    })
    .from(schema.evidenceRequestDecisions)
    .where(eq(schema.evidenceRequestDecisions.evidenceRequestId, request.id))
    .orderBy(asc(schema.evidenceRequestDecisions.createdAt));

  const submissions: EvidenceSubmissionView[] = [];
  const linkedDecisionIds = new Set<string>();
  if (available) {
    const rows = await db
      .select()
      .from(schema.evidenceRequestSubmissions)
      .where(eq(schema.evidenceRequestSubmissions.evidenceRequestId, request.id))
      .orderBy(asc(schema.evidenceRequestSubmissions.roundNo));
    const links = await db
      .select({
        submissionId: schema.evidenceRequestDecisionSubmissions.submissionId,
        decisionId: schema.evidenceRequestDecisionSubmissions.decisionId,
      })
      .from(schema.evidenceRequestDecisionSubmissions)
      .innerJoin(
        schema.evidenceRequestDecisions,
        eq(
          schema.evidenceRequestDecisions.id,
          schema.evidenceRequestDecisionSubmissions.decisionId,
        ),
      )
      .where(eq(schema.evidenceRequestDecisions.evidenceRequestId, request.id));
    const decisionBySubmission = new Map(
      links.map((l) => [l.submissionId, decisions.find((d) => d.id === l.decisionId)]),
    );
    for (const l of links) linkedDecisionIds.add(l.decisionId);
    const newestRow = rows.reduce((max, r) => Math.max(max, r.roundNo), 0);
    for (const row of rows) {
      let decision = decisionBySubmission.get(row.id);
      // The newest send may have been decided by an older deployment running beside this one,
      // without a link: that decision is then its decision, not a separate older send.
      if (!decision && row.roundNo === newestRow) {
        const late = await newerUnlinkedDecision(db, request.id, row.sentAt);
        decision = late ? decisions.find((d) => d.id === late.id) : undefined;
        if (decision) linkedDecisionIds.add(decision.id);
      }
      const state: EvidenceSubmissionState = decision
        ? decision.outcome === 'CANCELLED'
          ? 'WITHDRAWN'
          : (decision.outcome as Exclude<
              EvidenceSubmissionState,
              'AWAITING_DECISION' | 'WITHDRAWN'
            >)
        : request.status === 'CANCELLED'
          ? 'WITHDRAWN'
          : 'AWAITING_DECISION';
      const serving = agency
        ? await evidenceSubmissionServing(db, row)
        : { serves: false as const };
      const live = first(
        await db
          .select({ safetyStatus: schema.documentVersions.safetyStatus })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.id, row.documentVersionId))
          .limit(1),
      );
      submissions.push({
        id: row.id,
        roundNo: row.roundNo,
        documentId: row.documentId,
        documentVersionId: row.documentVersionId,
        versionNumber: row.versionNumber,
        docType: row.docTypeAtSend,
        title: row.titleAtSend,
        sizeBytes: row.sizeBytes,
        checksumFingerprint: row.contentSha256 ? row.contentSha256.slice(0, 12) : null,
        sentAt: row.sentAt,
        state,
        decidedAt: decision?.decidedAt ?? null,
        reason: decision?.reason ?? null,
        fileAvailable: serving.serves && (await pinnedCopyForServing(db, row)).ok,
        safetyStatus: live?.safetyStatus ?? null,
      });
    }
  }

  // Decisions with no exact copy behind them, and a send still waiting that was never pinned.
  const legacy: LegacyEvidenceSend[] = decisions
    .filter((d) => d.outcome !== 'CANCELLED' && !linkedDecisionIds.has(d.id))
    .map((d) => ({
      label: LEGACY_SEND_LABEL,
      documentId: d.documentId,
      sentAt: null,
      state: d.outcome as LegacyEvidenceSend['state'],
      decidedAt: d.decidedAt,
    }));
  const newestRound = submissions.reduce((max, s) => Math.max(max, s.roundNo), 0);
  const waitingIsPinned = submissions.some(
    (s) =>
      s.roundNo === newestRound &&
      s.state === 'AWAITING_DECISION' &&
      s.documentId === request.respondingDocumentId,
  );
  if (
    (request.status === 'RECEIVED' || request.status === 'UNDER_REVIEW') &&
    request.respondingDocumentId !== null &&
    !waitingIsPinned
  ) {
    legacy.push({
      label: LEGACY_SEND_LABEL,
      documentId: request.respondingDocumentId,
      sentAt: request.respondedAt,
      state: 'AWAITING_DECISION',
      decidedAt: null,
    });
  }
  return ok({ available, submissions, legacy });
}

type PinnedCopy =
  | {
      readonly ok: true;
      readonly document: typeof schema.documents.$inferSelect;
      readonly version: typeof schema.documentVersions.$inferSelect;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether the pinned copy could be served right now, apart from who asks and why: the document is
 * still present (not in Recently Deleted), the pinned version is the same stored object with the
 * same checksum, and it is safe, processed and not erased. The one definition the list (for its
 * file flag) and the download both use, so the two cannot disagree. Mints no link.
 */
async function pinnedCopyForServing(
  db: Db,
  submission: typeof schema.evidenceRequestSubmissions.$inferSelect,
): Promise<PinnedCopy> {
  const lifecycle = await lifecycleTablesPresent(db);
  const document = first(
    await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, submission.documentId),
          lifecycle ? presentDocumentCondition() : undefined,
        ),
      )
      .limit(1),
  );
  const version = first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, submission.documentVersionId))
      .limit(1),
  );
  if (!document || !version || !pinnedVersionIntact(submission, version)) {
    return { ok: false, reason: 'pinned_version_changed' };
  }
  const erased = await hasActiveOrVerifiedErasureJob(db, version.storageObjectId);
  const servable = isDocumentVersionUsable({
    safetyStatus: version.safetyStatus,
    processingStatus: version.processingStatus,
    erased,
  });
  if (!servable) {
    return { ok: false, reason: erased ? 'bytes_already_erased' : 'not_yet_safe_to_serve' };
  }
  return { ok: true, document, version };
}

export interface EvidenceSubmissionDownloadInput {
  readonly submissionId: string;
  readonly accessTokenSecret: string;
  /**
   * A recent identity confirmation by this agency admin for exactly this version
   * (`verifyStepUp`, action `DOWNLOAD_ORIGINAL`), as every original download needs.
   */
  readonly stepUp?: StepUpProof | undefined;
  readonly now?: Date;
}

/**
 * The original file of exactly one copy a traveller sent in answer to an evidence request, for the
 * agency that asked. Never "the latest version": the pinned version is read, so a later upload of
 * the same document is never reachable this way. A download of the original, never a preview (a
 * preview for anyone but the owner must be the masked rendering, ADR 0022 decision 6), and it
 * needs a recent identity confirmation. Served only to an active OWNER or ADMIN of the asking
 * organization, which must still hold its MANAGE grant, and only while the copy is the one waiting
 * for a decision or the one that was accepted: a copy that was sent back, an older send, and a
 * withdrawn request serve nothing. The same servability and erasure checks as every other file,
 * one audit event per request (ids only), the name the file had when sent, and a link the serving
 * route re-checks against the live send.
 */
export async function downloadEvidenceSubmissionFile(
  storage: StoragePort,
  access: AuthorizedApplicant<'MANAGE'>,
  input: EvidenceSubmissionDownloadInput,
): Promise<Result<AccessRef, ServiceError>> {
  const db = access.tx;
  const notFound = err(keyedError('not_found', 'evidence_submissions.document_not_found'));
  if (!isUuid(input.submissionId)) return notFound;
  if (!(await evidenceSubmissionsPresent(db))) return notFound;
  const submission = first(
    await db
      .select()
      .from(schema.evidenceRequestSubmissions)
      .where(eq(schema.evidenceRequestSubmissions.id, input.submissionId))
      .limit(1),
  );
  if (!submission) return notFound;
  const audience = await evidenceAudienceOf(access, submission.evidenceRequestId);
  if (!audience.ok || !audience.value.agency) return notFound;
  const { request, agency } = audience.value;

  const serving = await evidenceSubmissionServing(db, submission);
  const metadata = {
    variant: 'original',
    disposition: 'download',
    purpose: 'evidence_submission',
    organizationId: agency.organizationId,
    submissionId: submission.id,
    requestId: request.id,
  };
  const audit = async (result: 'ALLOWED' | 'DENIED', reason: string | null): Promise<void> => {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'DOCUMENT_ACCESS',
        actorAccountId: agency.accountId,
        actorRole: 'org:evidence_submission',
        action: 'DOWNLOAD_ORIGINAL',
        result,
        method: 'API',
        applicantId: request.applicantId,
        resourceType: 'document',
        resourceId: submission.documentId,
        reason,
        metadata,
      });
    });
  };

  if (!serving.serves) {
    await audit('DENIED', serving.reason);
    return err(keyedError('forbidden', 'evidence_submissions.this_copy_is_no_longer_available'));
  }
  const stepUpSatisfied = StepUpProof.covers(input.stepUp, {
    accountId: agency.accountId,
    action: 'DOWNLOAD_ORIGINAL',
    resourceId: submission.documentVersionId,
  });
  if (!stepUpSatisfied) {
    await audit('DENIED', 'step_up_required');
    return err(
      keyedError('step_up_required', 'evidence_submissions.confirm_it_is_you_to_download'),
    );
  }
  const pinned = await pinnedCopyForServing(db, submission);
  await audit(pinned.ok ? 'ALLOWED' : 'DENIED', pinned.ok ? null : pinned.reason);
  if (!pinned.ok) {
    return err(
      serviceError(
        'forbidden',
        pinned.reason === 'pinned_version_changed'
          ? 'this copy is no longer available to download'
          : 'this document is not yet available',
      ),
    );
  }
  return issueEvidenceSubmissionReadRef(db, storage, {
    document: pinned.document,
    version: pinned.version,
    submissionId: submission.id,
    accountId: agency.accountId,
    organizationId: agency.organizationId,
    filename: submission.titleAtSend,
    accessTokenSecret: input.accessTokenSecret,
    now: input.now ?? new Date(),
  });
}
