import 'server-only';
import {
  type Db,
  type EvidenceRequest,
  REQUEST_HISTORY_MAX_REQUESTS,
  accountPrincipal,
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

/** What the thread of one request is built from, beyond the request row itself. */
export interface RequestHistory {
  readonly decisions: ThreadRead<readonly ThreadDecision[]>;
  readonly sends: ThreadRead<ThreadSendList>;
}

const nothing: RequestHistory = { decisions: { state: 'none' }, sends: { state: 'none' } };
const unread: RequestHistory = { decisions: { state: 'unread' }, sends: { state: 'unread' } };

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

  let read: Awaited<ReturnType<typeof listRequestHistoriesForOwner>>[] | null = null;
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
      read = await Promise.all(
        chunks.map((chunk) =>
          listRequestHistoriesForOwner(proof.value, { requestIds: chunk.map((r) => r.id) }),
        ),
      );
    }
  } catch (error) {
    reportServerError('requestThreadRead', error, { step: 'history read' });
  }

  const found = new Map<
    string,
    NonNullable<typeof read>[number] extends infer R
      ? R extends { ok: true; value: ReadonlyMap<string, infer H> }
        ? H
        : never
      : never
  >();
  for (const result of read ?? []) {
    if (result.ok) for (const [id, history] of result.value) found.set(id, history);
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
          }
        : unread,
    );
  }
  return out;
}
