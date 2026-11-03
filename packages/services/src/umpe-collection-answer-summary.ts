import { and, count, eq, inArray, sql } from 'drizzle-orm';
import {
  agencyMayReceiveAnswers,
  liveResponseDecisionCounts,
} from './access/collection-response-access';
import {
  type AgencyCollectionScope,
  agencyCollectionScopeProblem,
} from './access/collection-scope';
import { guestUploadsPresent, liveGuestSubmission } from './access/guest-submission-access';
import { type Db, schema } from './db';
import { isUuid } from './lifecycle/foundation/ids';
import { COLLECTION_LIST_LIMIT } from './umpe-collection-request-service';

/**
 * What came back on each document request, as plain counts (UMPE UX5), for the agency's request
 * list. Counts only: no names, ids, notes or file data leave this file.
 *
 * - `answers`: live answers, a signed-in person's response (one live answer per person) plus a
 *   guest's submission (see the guest rule below).
 * - `waiting`: answers with no decision yet, or whose latest decision is Received (it arrived and
 *   is being looked at, but nobody has decided). Received is never "reviewed" or "accepted".
 * - `needsCorrection` and `accepted`: answers whose latest decision is that one. The latest
 *   decision is the newest `decidedAt`, ties broken by id, so a later decision overrides an earlier
 *   one. `answers` is always `waiting + needsCorrection + accepted`.
 *
 * Guest rule: a guest who sends again makes a new submission with the next number. Only the NEWEST
 * submission of each (request, recipient) is counted, so an old revision nobody reviewed can never
 * inflate Waiting once the guest has sent a newer one.
 *
 * Who may read it: the same owners and admins who read the answers themselves. A member with May
 * Request Documents, a refused or stale scope, the switch off, or an agency VisaStack has not yet
 * reviewed gets an empty map, exactly as the answers panel gives them nothing. Every query is bound
 * to the scope's organization and to requests of that organization.
 */

export interface CollectionAnswerSummary {
  readonly answers: number;
  readonly waiting: number;
  readonly needsCorrection: number;
  readonly accepted: number;
}

interface Tally {
  answers: number;
  waiting: number;
  needsCorrection: number;
  accepted: number;
}

/** One grouped row: requests' answers sharing a latest decision (null: none yet). */
interface DecisionCount {
  readonly requestId: string;
  readonly decision: string | null;
  readonly n: number;
}

function fold(into: Map<string, Tally>, rows: readonly DecisionCount[]): void {
  for (const row of rows) {
    const tally = into.get(row.requestId) ?? {
      answers: 0,
      waiting: 0,
      needsCorrection: 0,
      accepted: 0,
    };
    tally.answers += row.n;
    if (row.decision === 'NEEDS_CORRECTION') tally.needsCorrection += row.n;
    else if (row.decision === 'ACCEPTED') tally.accepted += row.n;
    else tally.waiting += row.n;
    into.set(row.requestId, tally);
  }
}

/**
 * The answer counts of these requests of this agency. A request with no live answer has no entry
 * (read it as zero). Ids that are not uuids, that repeat, that belong to another agency or that
 * come after the first `COLLECTION_LIST_LIMIT` are ignored.
 */
export async function summariseCollectionAnswers(
  db: Db,
  scope: AgencyCollectionScope,
  requestIds: readonly string[],
): Promise<ReadonlyMap<string, CollectionAnswerSummary>> {
  const none = new Map<string, CollectionAnswerSummary>();
  if (agencyCollectionScopeProblem(scope)) return none;
  const wanted = [
    ...new Set(requestIds.filter((id): id is string => isUuid(id)).map((id) => id.toLowerCase())),
  ].slice(0, COLLECTION_LIST_LIMIT);
  if (wanted.length === 0) return none;
  if (!(await agencyMayReceiveAnswers(db, scope.organizationId))) return none;

  // Only requests of this agency, whatever ids the caller passed.
  const requests = schema.agencyCollectionRequests;
  const ownRequests = await db
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.organizationId, scope.organizationId), inArray(requests.id, wanted)));
  const ids = ownRequests.map((row) => row.id);
  if (ids.length === 0) return none;

  const reviewsPresent = await guestUploadsPresent(db);
  const tallies = new Map<string, Tally>();

  // Signed-in answers are read beside the other readers of the response table (it holds a person's id).
  fold(tallies, await liveResponseDecisionCounts(db, scope, ids, reviewsPresent));

  if (reviewsPresent) {
    const submissions = schema.agencyCollectionGuestSubmissions;
    const answers = db
      .select({
        requestId: submissions.requestId,
        decision: sql<
          string | null
        >`(select v.decision from agency_collection_reviews v where v.guest_submission_id = agency_collection_guest_submissions.id and v.organization_id = agency_collection_guest_submissions.organization_id order by v.decided_at desc, v.id desc limit 1)`.as(
          'decision',
        ),
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.organizationId, scope.organizationId),
          inArray(submissions.requestId, ids),
          liveGuestSubmission(),
          // Only the newest submission of each recipient (the guest rule above).
          sql`${submissions.submissionNo} = (select max(g.submission_no) from agency_collection_guest_submissions g where g.organization_id = ${submissions.organizationId} and g.request_id = ${submissions.requestId} and g.recipient_key = ${submissions.recipientKey})`,
        ),
      )
      .as('guest_answers');
    fold(
      tallies,
      await db
        .select({ requestId: answers.requestId, decision: answers.decision, n: count() })
        .from(answers)
        .groupBy(answers.requestId, answers.decision),
    );
  }

  return new Map(tallies);
}
