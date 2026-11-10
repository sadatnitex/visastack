import 'server-only';
import {
  type AuthorizedApplicant,
  type Db,
  type EvidenceRequest,
  accountPrincipal,
  listEvidenceRequestDecisions,
  listEvidenceSubmissions,
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

/** Requests are read this many at a time, so a long list never opens hundreds of reads at once. */
const BATCH = 10;

const nothing: RequestHistory = { decisions: { state: 'none' }, sends: { state: 'none' } };
const unread: RequestHistory = { decisions: { state: 'unread' }, sends: { state: 'unread' } };

/**
 * The history behind each request's thread, read as the traveller who owns it: the decisions made
 * on it, and for a document the exact sends with their times. Both go through the services that
 * decide who may see them (the owner's own access proof for the sends). A request nobody has
 * answered yet has no history to read. A read that fails is `unread`, which the thread says in
 * words; it is never turned into "no history".
 */
export async function loadRequestHistories(input: {
  readonly db: Db;
  readonly accountId: string;
  readonly applicantId: string;
  readonly requests: readonly EvidenceRequest[];
}): Promise<ReadonlyMap<string, RequestHistory>> {
  const { db, accountId, applicantId } = input;
  const out = new Map<string, RequestHistory>();
  const withHistory = input.requests.filter((r) => r.status !== 'OPEN' || r.respondedAt !== null);
  for (const r of input.requests) if (!withHistory.includes(r)) out.set(r.id, nothing);
  if (withHistory.length === 0) return out;

  let manage: AuthorizedApplicant<'MANAGE'> | null = null;
  if (withHistory.some((r) => r.kind === 'DOCUMENT')) {
    try {
      const proof = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { applicantId },
        { purpose: 'self' },
      );
      manage = proof.ok ? proof.value : null;
    } catch (error) {
      reportServerError('requestThreadAccess', error, { step: 'manage proof' });
    }
  }

  const readOne = async (request: EvidenceRequest): Promise<RequestHistory> => {
    try {
      const [decisions, sends] = await Promise.all([
        listEvidenceRequestDecisions(db, accountId, request.id),
        request.kind === 'DOCUMENT' && manage
          ? listEvidenceSubmissions(manage, { requestId: request.id })
          : null,
      ]);
      return {
        decisions: decisions.ok
          ? {
              state: 'read',
              value: decisions.value.map((d) => ({
                outcome: d.outcome,
                reason: d.reason,
                createdAt: d.createdAt,
              })),
            }
          : { state: 'unread' },
        sends:
          request.kind !== 'DOCUMENT'
            ? { state: 'none' }
            : sends?.ok
              ? {
                  state: 'read',
                  value: toThreadSendList(sends.value),
                }
              : { state: 'unread' },
      };
    } catch (error) {
      reportServerError('requestThreadRead', error, { step: 'history read' });
      return unread;
    }
  };

  for (let at = 0; at < withHistory.length; at += BATCH) {
    const batch = withHistory.slice(at, at + BATCH);
    const read = await Promise.all(batch.map(readOne));
    batch.forEach((request, index) => out.set(request.id, read[index] ?? unread));
  }
  return out;
}
