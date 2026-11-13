import { type SendState, sendStateOf } from './classify';

/*
 * The latest round of one evidence request, worked out from its stored sends and decisions.
 *
 * The same reading as the two read models that already show a request's history to a person
 * (`listEvidenceSubmissions` for documents, `fieldHistories` behind `listFieldAnswersForOwner` for
 * details), written once for both kinds and for many requests at a time, so the impact read costs
 * a fixed number of statements. `parity.test.ts` holds it to those two read models on the shared
 * scenario, so the three cannot drift apart unnoticed. Pure: it reads no table.
 */

/** One pinned send: an exact copy or an exact saved value. */
export interface StoredSend {
  readonly id: string;
  readonly requestId: string;
  readonly roundNo: number;
  readonly sentAt: Date;
  /** The document or detail the send carried. */
  readonly subjectId: string;
  /** The exact document version or saved value it pinned. */
  readonly versionId: string;
  /** False when the pinned version is gone or no longer the stored object that was sent. */
  readonly intact: boolean;
}

export interface StoredDecision {
  readonly id: string;
  readonly requestId: string;
  readonly outcome: string;
  readonly decidedAt: Date;
  /** The document or detail the decision names (kept before exact versions were). */
  readonly subjectId: string | null;
  /** The send this decision is tied to, when it is tied to one. */
  readonly sendId: string | null;
}

export interface RoundRequest {
  readonly id: string;
  readonly status: string;
  /** The document or detail the request currently points at as its answer. */
  readonly respondingId: string | null;
  readonly respondedAt: Date | null;
}

export type LatestRound =
  | {
      readonly precision: 'pinned';
      readonly state: SendState;
      readonly send: StoredSend;
      readonly sentAt: Date;
      readonly decidedAt: Date | null;
    }
  | {
      /** Recorded before exact versions were kept: which copy or value went is not known. */
      readonly precision: 'legacy';
      readonly state: SendState;
      readonly subjectId: string | null;
      readonly sentAt: Date | null;
      readonly decidedAt: Date | null;
    };

const WAITING_FOR_DECISION: ReadonlySet<string> = new Set(['RECEIVED', 'UNDER_REVIEW']);

/**
 * Every round of one request, oldest first. `waitingSendMatches` says whether a pinned send that
 * still waits is the answer the request points at (a document send must be the responding
 * document; a detail send always is).
 */
export function roundsOf(
  request: RoundRequest,
  sends: readonly StoredSend[],
  decisions: readonly StoredDecision[],
  waitingSendMatches: (send: StoredSend) => boolean,
): LatestRound[] {
  const ordered = [...sends].sort((a, b) => a.roundNo - b.roundNo);
  const byTime = [...decisions].sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime());
  const linked = new Set(byTime.flatMap((d) => (d.sendId ? [d.id] : [])));
  const newest = ordered[ordered.length - 1];
  const taken = new Set<string>();
  const rounds: LatestRound[] = [];
  let waitingIsPinned = false;

  for (const send of ordered) {
    let decision = byTime.find((d) => d.sendId === send.id);
    // The newest send may have been decided by an older deployment running beside this one,
    // without a link: that decision is then its decision, not a separate older send.
    if (!decision && send === newest) {
      decision = byTime.find(
        (d) => !linked.has(d.id) && d.decidedAt.getTime() > send.sentAt.getTime(),
      );
      if (decision) taken.add(decision.id);
    }
    const state = sendStateOf(decision?.outcome ?? null, request.status);
    if (send === newest && state === 'AWAITING_DECISION' && waitingSendMatches(send)) {
      waitingIsPinned = true;
    }
    rounds.push({
      precision: 'pinned',
      state,
      send,
      sentAt: send.sentAt,
      decidedAt: decision?.decidedAt ?? null,
    });
  }
  // Decisions with no exact send behind them, and an answer still waiting that was never pinned.
  for (const decision of byTime) {
    if (decision.outcome === 'CANCELLED' || linked.has(decision.id) || taken.has(decision.id)) {
      continue;
    }
    rounds.push({
      precision: 'legacy',
      state: sendStateOf(decision.outcome, request.status),
      subjectId: decision.subjectId,
      sentAt: null,
      decidedAt: decision.decidedAt,
    });
  }
  if (
    WAITING_FOR_DECISION.has(request.status) &&
    request.respondingId !== null &&
    !waitingIsPinned
  ) {
    rounds.push({
      precision: 'legacy',
      state: 'AWAITING_DECISION',
      subjectId: request.respondingId,
      sentAt: request.respondedAt,
      decidedAt: null,
    });
  }
  const at = (round: LatestRound) => (round.sentAt ?? round.decidedAt)?.getTime() ?? 0;
  return rounds.sort((a, b) => at(a) - at(b));
}

/** The request's latest round, or null when nothing is recorded as sent. */
export function latestRoundOf(
  request: RoundRequest,
  sends: readonly StoredSend[],
  decisions: readonly StoredDecision[],
  waitingSendMatches: (send: StoredSend) => boolean,
): LatestRound | null {
  const rounds = roundsOf(request, sends, decisions, waitingSendMatches);
  return rounds[rounds.length - 1] ?? null;
}
