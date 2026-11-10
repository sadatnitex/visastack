import { type Result, err, ok } from '@visastack/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AuthorizedApplicant } from './access/require-access';
import { schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { evidenceSubmissionsPresent } from './evidence-submission-tables';
import {
  type EvidenceSubmissionList,
  type EvidenceSubmissionState,
  type EvidenceSubmissionView,
  LEGACY_SEND_LABEL,
  type LegacyEvidenceSend,
} from './evidence-submissions';
import { isUuid } from './lifecycle/foundation/ids';

/**
 * What was said on a page of evidence requests, read for the traveller who owns them in a fixed
 * number of queries however many requests there are (the conversation on the traveller's
 * Requests from Agencies screen). It is the batched form of `listEvidenceSubmissions` plus the
 * decision history, for the owner only:
 *
 * - the caller must hold the owner's own MANAGE proof (`applicant_owner`); anyone else is told the
 *   same "not found" as for a request that does not exist;
 * - a request id that is not this traveller's, is malformed or does not exist is left out of the
 *   result, never described;
 * - nothing but safe facts leaves here, as in the single reader: no storage key, no file content,
 *   no download flag (always false) and no scan status (always null) for the traveller;
 * - each request shows its newest `REQUEST_HISTORY_SENDS_SHOWN` sends and decisions, and says how
 *   many older sends are not included.
 */
export const REQUEST_HISTORY_SENDS_SHOWN = 20;
/** The most request ids one call reads, so a call stays a bounded set of queries. */
export const REQUEST_HISTORY_MAX_REQUESTS = 100;

export interface RequestHistoryDecision {
  readonly outcome: (typeof schema.evidenceRequestDecisions.$inferSelect)['outcome'];
  readonly reason: string | null;
  readonly createdAt: Date;
}

export interface RequestHistory {
  /** Oldest first, newest `REQUEST_HISTORY_SENDS_SHOWN` at most. */
  readonly decisions: readonly RequestHistoryDecision[];
  /** The same list `listEvidenceSubmissions` gives the traveller, newest sends only. */
  readonly sends: EvidenceSubmissionList;
  /** Sends before the ones listed, which are not included. */
  readonly olderSends: number;
}

export async function listRequestHistoriesForOwner(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly requestIds: readonly string[] },
): Promise<Result<ReadonlyMap<string, RequestHistory>, ServiceError>> {
  const notFound = err(serviceError('not_found', 'evidence request not found'));
  if (access.actor.kind !== 'applicant_owner') return notFound;
  if (input.requestIds.length > REQUEST_HISTORY_MAX_REQUESTS) {
    return err(serviceError('invalid', 'too many requests in one read'));
  }
  const db = access.tx;
  const wanted = [...new Set(input.requestIds.filter(isUuid))];
  const out = new Map<string, RequestHistory>();
  if (wanted.length === 0) return ok(out);

  // Only this traveller's own requests: anything else is simply absent.
  const requests = await db
    .select({
      id: schema.evidenceRequests.id,
      kind: schema.evidenceRequests.kind,
      status: schema.evidenceRequests.status,
      respondingDocumentId: schema.evidenceRequests.respondingDocumentId,
      respondedAt: schema.evidenceRequests.respondedAt,
    })
    .from(schema.evidenceRequests)
    .where(
      and(
        inArray(schema.evidenceRequests.id, wanted),
        eq(schema.evidenceRequests.applicantId, access.applicant.id),
      ),
    );
  if (requests.length === 0) return ok(out);
  const ids = requests.map((r) => r.id);

  const [available, decisionRows] = await Promise.all([
    evidenceSubmissionsPresent(db),
    db
      .select({
        id: schema.evidenceRequestDecisions.id,
        requestId: schema.evidenceRequestDecisions.evidenceRequestId,
        outcome: schema.evidenceRequestDecisions.outcome,
        reason: schema.evidenceRequestDecisions.reason,
        documentId: schema.evidenceRequestDecisions.respondingDocumentId,
        createdAt: schema.evidenceRequestDecisions.createdAt,
      })
      .from(schema.evidenceRequestDecisions)
      .where(inArray(schema.evidenceRequestDecisions.evidenceRequestId, ids))
      .orderBy(asc(schema.evidenceRequestDecisions.createdAt)),
  ]);

  const sendRows = available
    ? await db
        .select()
        .from(schema.evidenceRequestSubmissions)
        .where(inArray(schema.evidenceRequestSubmissions.evidenceRequestId, ids))
        .orderBy(asc(schema.evidenceRequestSubmissions.roundNo))
    : [];
  const links = available
    ? await db
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
        .where(inArray(schema.evidenceRequestDecisions.evidenceRequestId, ids))
    : [];
  const decisionBySubmission = new Map(links.map((l) => [l.submissionId, l.decisionId]));
  const linkedDecisionIds = new Set(links.map((l) => l.decisionId));

  for (const request of requests) {
    const decisions = decisionRows.filter((d) => d.requestId === request.id);
    let submissions: EvidenceSubmissionView[] = [];
    const legacy: LegacyEvidenceSend[] = [];
    // A value is not a file: a detail has no exact copy to keep.
    if (request.kind === 'DOCUMENT') {
      const rows = sendRows.filter((s) => s.evidenceRequestId === request.id);
      const newestRow = rows.reduce((max, r) => Math.max(max, r.roundNo), 0);
      const used = new Set<string>();
      for (const row of rows) {
        const linked = decisionBySubmission.get(row.id);
        let decision = linked ? decisions.find((d) => d.id === linked) : undefined;
        // The newest send may have been decided by an older deployment running beside this one,
        // without a link: that decision is then its decision, not a separate older send.
        if (!decision && row.roundNo === newestRow) {
          decision = decisions.find(
            (d) => !linkedDecisionIds.has(d.id) && d.createdAt.getTime() > row.sentAt.getTime(),
          );
          if (decision) used.add(decision.id);
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
          decidedAt: decision?.createdAt ?? null,
          reason: decision?.reason ?? null,
          // The traveller never gets a download from this list, and no scan status.
          fileAvailable: false,
          safetyStatus: null,
        });
      }
      for (const d of decisions) {
        if (d.outcome === 'CANCELLED' || linkedDecisionIds.has(d.id) || used.has(d.id)) continue;
        legacy.push({
          label: LEGACY_SEND_LABEL,
          documentId: d.documentId,
          sentAt: null,
          state: d.outcome as Exclude<LegacyEvidenceSend['state'], never>,
          decidedAt: d.createdAt,
        });
      }
      const waitingIsPinned = submissions.some(
        (s) =>
          s.roundNo === newestRow &&
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
    }
    const olderSends = Math.max(0, submissions.length - REQUEST_HISTORY_SENDS_SHOWN);
    if (olderSends > 0) submissions = submissions.slice(-REQUEST_HISTORY_SENDS_SHOWN);
    out.set(request.id, {
      decisions: decisions
        .slice(-REQUEST_HISTORY_SENDS_SHOWN)
        .map((d) => ({ outcome: d.outcome, reason: d.reason, createdAt: d.createdAt })),
      sends: { available, submissions, legacy },
      olderSends,
    });
  }
  return ok(out);
}
