import 'server-only';
import {
  type Db,
  type EvidenceRequest,
  FIELD_ANSWER_MAX_REQUESTS,
  type FieldAnswerHistory,
  REQUEST_HISTORY_MAX_REQUESTS,
  type RequestHistory as ServiceRequestHistory,
  accountPrincipal,
  listFieldAnswersForOwner,
  listRequestHistoriesForOwner,
  requireAccess,
} from '@visastack/services';
import {
  type ThreadDecision,
  type ThreadRead,
  type ThreadSendList,
  toThreadSendList,
} from '../../../../../components/request-thread/thread-model';
import { reportServerError } from '../../../../../lib/server-error';
import { type SentBackRead, sentBackCopyOf } from './sent-back-copy';

/** What the thread of one request is built from, beyond the request row itself. */
export interface RequestHistory {
  readonly decisions: ThreadRead<readonly ThreadDecision[]>;
  readonly sends: ThreadRead<ThreadSendList>;
  /**
   * Which copy the agency sent back, read from the decision history (the request's own answer
   * pointer is cleared by a send-back). `none` unless the request waits on a corrected answer.
   */
  readonly sentBack: SentBackRead;
  /**
   * For a detail request: the exact saved value sent in each round (or the plain admission that an
   * older answer did not record it). `none` for a document request or one nobody answered.
   */
  readonly fieldAnswer: ThreadRead<FieldAnswerHistory>;
}

const nothing: RequestHistory = {
  decisions: { state: 'none' },
  sends: { state: 'none' },
  sentBack: { state: 'none' },
  fieldAnswer: { state: 'none' },
};

/** A history that could not be read: a request sent back is then `unknown`, never "nothing sent back". */
function unreadFor(request: EvidenceRequest): RequestHistory {
  return {
    decisions: { state: 'unread' },
    sends: { state: 'unread' },
    sentBack: request.status === 'NEEDS_REPLACEMENT' ? { state: 'unknown' } : { state: 'none' },
    fieldAnswer: request.kind === 'FIELD' ? { state: 'unread' } : { state: 'none' },
  };
}

/**
 * The history behind each request's thread, read as the traveller who owns the requests: the
 * decisions made on each and, for a document, the newest sends with their times. It is one batched
 * read through the owner's own access proof (a fixed number of queries however many requests are
 * listed, in chunks of at most `REQUEST_HISTORY_MAX_REQUESTS`), never one read per request. A
 * request nobody has answered has no history to read. A read that fails, or a request the service
 * leaves out, is `unread`, which the thread says in words; it is never turned into "no history".
 */
export async function loadRequestHistories(input: {
  readonly db: Db;
  readonly accountId: string;
  readonly applicantId: string;
  readonly requests: readonly EvidenceRequest[];
}): Promise<ReadonlyMap<string, RequestHistory>> {
  const out = new Map<string, RequestHistory>();
  const withHistory = input.requests.filter((r) => r.status !== 'OPEN' || r.respondedAt !== null);
  for (const r of input.requests) if (!withHistory.includes(r)) out.set(r.id, nothing);
  if (withHistory.length === 0) return out;

  // One batched read per chunk of ids. A chunk that fails leaves only its own requests unread.
  const found = new Map<string, ServiceRequestHistory>();
  const foundFields = new Map<string, FieldAnswerHistory>();
  let fieldsRead = false;
  try {
    const proof = await requireAccess(
      input.db,
      accountPrincipal(input.accountId),
      'MANAGE',
      { applicantId: input.applicantId },
      { purpose: 'self' },
    );
    if (proof.ok) {
      const chunks: EvidenceRequest[][] = [];
      for (let at = 0; at < withHistory.length; at += REQUEST_HISTORY_MAX_REQUESTS) {
        chunks.push(withHistory.slice(at, at + REQUEST_HISTORY_MAX_REQUESTS));
      }
      const results = await Promise.all(
        chunks.map((chunk) =>
          listRequestHistoriesForOwner(proof.value, {
            requestIds: chunk.map((r) => r.id),
          }).catch((error: unknown) => {
            reportServerError('requestThreadRead', error, { step: 'history read' });
            return null;
          }),
        ),
      );
      for (const result of results) {
        if (result?.ok) for (const [id, history] of result.value) found.set(id, history);
      }
      // The exact value each detail answer carried, in the same proof's own batched reads.
      const fieldIds = withHistory.filter((r) => r.kind === 'FIELD').map((r) => r.id);
      const fieldChunks: string[][] = [];
      for (let at = 0; at < fieldIds.length; at += FIELD_ANSWER_MAX_REQUESTS) {
        fieldChunks.push(fieldIds.slice(at, at + FIELD_ANSWER_MAX_REQUESTS));
      }
      const fieldResults = await Promise.all(
        fieldChunks.map((requestIds) =>
          listFieldAnswersForOwner(proof.value, { requestIds }).catch((error: unknown) => {
            reportServerError('requestThreadRead', error, { step: 'field answer read' });
            return null;
          }),
        ),
      );
      fieldsRead = fieldResults.every((result) => result?.ok === true);
      for (const result of fieldResults) {
        if (result?.ok) for (const [id, history] of result.value) foundFields.set(id, history);
      }
    }
  } catch (error) {
    reportServerError('requestThreadRead', error, { step: 'history access' });
  }

  for (const request of withHistory) {
    const history = found.get(request.id);
    out.set(
      request.id,
      history
        ? {
            decisions: {
              state: 'read',
              value: history.decisions.map((d) => ({
                outcome: d.outcome,
                reason: d.reason,
                createdAt: d.createdAt,
              })),
            },
            sends:
              request.kind === 'DOCUMENT'
                ? { state: 'read', value: toThreadSendList(history.sends, history.olderSends) }
                : { state: 'none' },
            sentBack:
              request.kind === 'DOCUMENT'
                ? sentBackCopyOf(request.status, history.sends)
                : { state: 'none' },
            fieldAnswer: fieldAnswerRead(request, foundFields.get(request.id), fieldsRead),
          }
        : unreadFor(request),
    );
  }
  return out;
}

/**
 * The detail answer's history for one request: read, or `unread` (never turned into "nothing was
 * sent") when the batched read failed or left the request out.
 */
function fieldAnswerRead(
  request: EvidenceRequest,
  found: FieldAnswerHistory | undefined,
  allRead: boolean,
): ThreadRead<FieldAnswerHistory> {
  if (request.kind !== 'FIELD') return { state: 'none' };
  if (found) return { state: 'read', value: found };
  return allRead ? { state: 'none' } : { state: 'unread' };
}
