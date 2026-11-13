import { type Result, err } from '@visastack/core';
import { ACCESS_REFUSAL, AuthorizedApplicant } from '../access/require-access';
import type { Db } from '../db';
import { type ServiceError, serviceError } from '../errors';
import { isInactiveCaseState } from '../umpe-package-tables';
import {
  type DraftItem,
  type SendCarries,
  agencyRequestItem,
  agencyWorkIsLive,
  classifySend,
  couldNotCheck,
  requestStanding,
} from './classify';
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

/**
 * Run one read: the presence checks on the caller's handle, then everything else in one
 * transaction, so the share lock the read takes on the changed item holds until its last
 * statement. A database failure comes back as a service error, never as a partial answer.
 */
export async function runRead<T>(
  access: Proof,
  read: (tx: Db, present: TablesPresent) => Promise<Result<T, ServiceError>>,
): Promise<Result<T, ServiceError>> {
  try {
    const present = await tablesPresent(access);
    return await access.tx.transaction((tx) => read(tx as unknown as Db, present));
  } catch {
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

/**
 * The traveller's live answers to agency checklists. An answer that holds the current copy or
 * value needs nothing, whatever the agency decided. For one that holds the earlier copy or value
 * the agency's decision would settle the outcome, and a traveller's read may not read it (see
 * `collectionAnswersCarrying`): rather than guess between "still checking", "accepted" and "sent
 * back", the agency part of the record is reported as not fully checked.
 */
export function collectionAnswerDrafts(
  answers: readonly CollectionAnswer[],
  carriesOf: (answer: CollectionAnswer) => SendCarries,
): DraftItem[] {
  const drafts: DraftItem[] = [];
  let earlierHeld = false;
  for (const answer of answers) {
    const carries = carriesOf(answer);
    if (carries === 'EARLIER') earlierHeld = true;
    if (carries !== 'CURRENT') continue;
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
        'AGENCY_HOLDS_CURRENT',
      ),
    );
  }
  if (earlierHeld) drafts.push(couldNotCheck('AGENCY_REQUESTS'));
  return drafts;
}

/** The agencies among these live shares. */
export function agenciesAmong(shares: readonly LiveShare[]): ReadonlySet<string> {
  return new Set(shares.flatMap((share) => (share.agencyId ? [share.agencyId] : [])));
}
