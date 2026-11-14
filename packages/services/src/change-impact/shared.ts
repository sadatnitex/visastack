import { type Result, err } from '@visastack/core';
import { ACCESS_REFUSAL, AuthorizedApplicant } from '../access/require-access';
import { FINISHED_CASE_STATES } from '../attention';
import type { Db } from '../db';
import { serverErrorEvent } from '../error-report';
import { type ServiceError, serviceError } from '../errors';
import { formatObservabilityLine } from '../observability-format';
import { isInactiveCaseState } from '../umpe-package-tables';
import {
  type DraftItem,
  type SendCarries,
  agencyRequestItem,
  agencyWorkIsLive,
  classifySend,
  requestStanding,
} from './classify';
import type { ImpactReason } from './contract';
import {
  type CollectionAnswer,
  type LiveShare,
  type RequestHistory,
  type TablesPresent,
  tablesPresent,
} from './load';
import { type LatestRound, type StoredSend, latestRoundOf } from './rounds';

/*
 * What the document read and the detail read share: who may read, how a read runs, and how a
 * request, an answered checklist and a share become items.
 */

type Proof = AuthorizedApplicant<'MANAGE'>;

/**
 * The central gate's single refusal, copied for each answer exactly as the gate does, so no
 * caller can tell a made-up id from a record of someone else or change the answer for the next.
 */
export function refused(): Result<never, ServiceError> {
  return err({ ...ACCESS_REFUSAL });
}

/**
 * Only the record's own traveller reads this: a genuine MANAGE proof from the central gate,
 * issued to the owner, for that owner's own record. An agency member (with any share), a person
 * the record was shared with, support staff and a copied or downgraded proof all fail here.
 */
export function isOwnersProof(access: Proof): boolean {
  return (
    AuthorizedApplicant.isGenuine(access, 'MANAGE') &&
    access.actor.kind === 'applicant_owner' &&
    access.actor.applicantId === access.applicant.id &&
    access.resource.applicantId === access.applicant.id
  );
}

/** Shown to the caller when the database itself failed; the cause is never passed on. */
export const READ_FAILED = 'the record could not be read';

/** The fixed place name a failed read is logged under. */
export const READ_FAILURE_PLACE = 'change_impact_read';

/**
 * The log line for a failed read: the error's type, its database code and where it was thrown,
 * as every server error is logged. Not its message: a failed statement's message repeats the
 * statement, and an error raised while assembling the answer could name a record.
 */
function readFailureLine(error: unknown): string {
  const event = serverErrorEvent(READ_FAILURE_PLACE, error);
  const { message: _message, ...metadata } = event.metadata ?? {};
  return formatObservabilityLine({ ...event, metadata });
}

/**
 * Run one read: the presence checks on the caller's handle, then everything else in one
 * transaction, so the share lock the read takes on the changed item holds until its last
 * statement. A database failure is logged once and comes back as a service error, never as a
 * partial answer.
 */
export async function runRead<T>(
  access: Proof,
  read: (tx: Db, present: TablesPresent) => Promise<Result<T, ServiceError>>,
): Promise<Result<T, ServiceError>> {
  try {
    const present = await tablesPresent(access);
    return await access.tx.transaction((tx) => read(tx as unknown as Db, present));
  } catch (error) {
    console.error(readFailureLine(error));
    return err(serviceError('upstream_error', READ_FAILED));
  }
}

export interface SendRules {
  /** What a round carried, relative to the change. */
  readonly carriesOf: (round: LatestRound) => SendCarries;
  /** Whether a pinned send that still waits is the answer the request points at. */
  readonly waitingSendMatches: (send: StoredSend) => boolean;
  /** What an answered request with no send or decision on record is taken to have carried. */
  readonly carriedWithoutRecord: (respondingId: string | null) => SendCarries;
  readonly waitsEvenOnCurrent: boolean;
  /** The agencies that hold a live share of this traveller's record. */
  readonly agenciesWithLiveShare: ReadonlySet<string>;
}

/** One evidence request, judged on its latest round. Null when it is not listed. */
export function evidenceRequestItem(history: RequestHistory, rules: SendRules): DraftItem | null {
  const { request } = history;
  const round = latestRoundOf(request, history.sends, history.decisions, rules.waitingSendMatches);
  // A request closed as fulfilled before decisions were recorded: an answer was given, and
  // nothing says which copy or value it was.
  const latest = round
    ? { state: round.state, carries: rules.carriesOf(round) }
    : request.status === 'FULFILLED'
      ? { state: 'ACCEPTED' as const, carries: rules.carriedWithoutRecord(request.respondingId) }
      : null;
  const reason = classifySend({
    standing: requestStanding(request.status),
    latest,
    caseFinished: request.mission ? FINISHED_CASE_STATES.has(request.mission.state) : false,
    liveWork: agencyWorkIsLive({
      caseLive: request.mission ? !isInactiveCaseState(request.mission.state) : null,
      agencyHoldsLiveShare: rules.agenciesWithLiveShare.has(request.agencyId),
    }),
    waitsEvenOnCurrent: rules.waitsEvenOnCurrent,
  });
  if (reason === null) return null;
  return agencyRequestItem(
    {
      source: 'EVIDENCE_REQUEST',
      requestId: request.id,
      agencyId: request.agencyId,
      agencyName: request.agencyName,
      missionId: request.mission ? request.missionId : null,
      caseTitle: request.mission?.title ?? null,
      sentAt: round?.sentAt ?? null,
      decidedAt: round?.decidedAt ?? null,
      createdAt: request.createdAt,
    },
    reason,
  );
}

/** The reasons that say "the stored records do not settle this request". */
const UNSETTLED: ReadonlySet<ImpactReason> = new Set([
  'RECORD_INCOMPLETE',
  'SENT_BEFORE_EXACT_VERSIONS',
]);

/**
 * Every evidence request as an item. A request's row, its sends and its decisions are read in
 * separate statements, so a send or a decision that lands between them can make one read see a
 * status that is older than the sends and decisions beside it. Such a torn look reads either as
 * a status and a decision that disagree, or as an answer waiting with no exact send behind it.
 * Before saying either, the requests that look unsettled are read once more, all together
 * (`readAgain`), and judged again: only what is still unsettled on the second look is reported.
 */
export async function evidenceRequestItems(
  histories: readonly RequestHistory[],
  rulesFor: (history: RequestHistory) => SendRules,
  readAgain: (requestIds: readonly string[]) => Promise<readonly RequestHistory[]>,
): Promise<DraftItem[]> {
  const judge = (history: RequestHistory) => evidenceRequestItem(history, rulesFor(history));
  const unsettled = (item: DraftItem | null) => item !== null && UNSETTLED.has(item.item.reason);
  const first = histories.map((history) => ({ history, item: judge(history) }));
  const doubtful = first
    .filter(({ item }) => unsettled(item))
    .map(({ history }) => history.request.id);
  if (doubtful.length === 0) return first.flatMap(({ item }) => (item ? [item] : []));
  const fresh = new Map(
    (await readAgain(doubtful)).map((history) => [history.request.id, history]),
  );
  return first.flatMap(({ history, item }) => {
    if (!unsettled(item)) return item ? [item] : [];
    const again = fresh.get(history.request.id);
    // A request that is gone on the second look has nothing left to report.
    const settled = again ? judge(again) : null;
    return settled ? [settled] : [];
  });
}

/** The stored status of a checklist request its agency has ended as finished (not withdrawn). */
const COLLECTION_CLOSED = 'CLOSED';

/**
 * The traveller's live answers to agency checklists, one item each. An answer that holds the
 * current copy or value needs nothing, whatever the agency decided. For one that holds the
 * earlier copy or value, where it stands (still being checked, accepted, sent back) is the
 * agency's review, which is not part of this read by design (see `collectionAnswersCarrying`):
 * the item says the answer holds the earlier copy or value and points at the answer itself,
 * never guessing its state. Nothing failed, so the read stays complete.
 */
export function collectionAnswerDrafts(
  answers: readonly CollectionAnswer[],
  carriesOf: (answer: CollectionAnswer) => SendCarries,
): DraftItem[] {
  const drafts: DraftItem[] = [];
  for (const answer of answers) {
    const carries = carriesOf(answer);
    if (carries !== 'CURRENT' && carries !== 'EARLIER') continue;
    drafts.push(
      agencyRequestItem(
        {
          source: 'COLLECTION_RESPONSE',
          requestId: answer.responseId,
          agencyId: answer.agencyId,
          agencyName: answer.agencyName,
          missionId: null,
          caseTitle: null,
          sentAt: answer.submittedAt,
          decidedAt: null,
          createdAt: answer.submittedAt,
        },
        carries === 'CURRENT'
          ? 'AGENCY_HOLDS_CURRENT'
          : // Only a collection recorded as closed is finished. A missing, unknown or unfinished
            // status is never taken as closed: the answer stays "cannot tell".
            answer.requestStatus === COLLECTION_CLOSED
            ? 'CHECKLIST_ANSWER_FINISHED'
            : 'CHECKLIST_ANSWER_HOLDS_EARLIER',
      ),
    );
  }
  return drafts;
}

/** The agencies among these live shares. */
export function agenciesAmong(shares: readonly LiveShare[]): ReadonlySet<string> {
  return new Set(shares.flatMap((share) => (share.agencyId ? [share.agencyId] : [])));
}
