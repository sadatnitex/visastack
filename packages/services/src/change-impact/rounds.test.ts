import { describe, expect, it } from 'vitest';
import { classifySend, requestStanding } from './classify';
import {
  type RoundRequest,
  type StoredDecision,
  type StoredSend,
  latestRoundOf,
  roundsOf,
} from './rounds';

/*
 * The latest round of a request, from its stored sends and decisions. Pure: no table is read.
 */

const DECIDED_AT = new Date('2026-10-01T10:00:00Z');

const sentBackEarlier: StoredDecision = {
  id: 'decision-1',
  requestId: 'request-1',
  outcome: 'NEEDS_REPLACEMENT',
  decidedAt: DECIDED_AT,
  subjectId: 'document-a',
  sendId: null,
};

function judged(request: RoundRequest) {
  const latest = latestRoundOf(request, [], [sentBackEarlier], () => true);
  const reason = classifySend({
    standing: requestStanding(request.status),
    latest: latest ? { state: latest.state, carries: 'EARLIER' } : null,
    liveWork: true,
    waitsEvenOnCurrent: false,
  });
  return { latest, reason };
}

describe('the latest round of a request', () => {
  it('takes an answer that still waits, with no recorded send time, as the newest round', () => {
    // An answer from before send times were kept: the request waits on the agency again after
    // an older decision sent the first answer back.
    const { latest, reason } = judged({
      id: 'request-1',
      status: 'RECEIVED',
      respondingId: 'document-a',
      respondedAt: null,
    });
    expect(latest).toMatchObject({ precision: 'legacy', state: 'AWAITING_DECISION', sentAt: null });
    expect(reason).toBe('AGENCY_CHECKING_EARLIER');

    // The same waiting answer behind a pinned send that was sent back after the older decision.
    // The pinned send is read first and the older decision after it, so only ordering by time
    // puts the rounds in the order they happened, with the waiting answer still the newest.
    const send: StoredSend = {
      id: 'send-1',
      requestId: 'request-1',
      roundNo: 1,
      sentAt: new Date(DECIDED_AT.getTime() + 60 * 60 * 1000),
      subjectId: 'document-a',
      versionId: 'version-a',
      intact: true,
    };
    const sentBackLater: StoredDecision = {
      id: 'decision-2',
      requestId: 'request-1',
      outcome: 'NEEDS_REPLACEMENT',
      decidedAt: new Date(DECIDED_AT.getTime() + 2 * 60 * 60 * 1000),
      subjectId: 'document-a',
      sendId: send.id,
    };
    const rounds = roundsOf(
      { id: 'request-1', status: 'RECEIVED', respondingId: 'document-a', respondedAt: null },
      [send],
      [sentBackLater, sentBackEarlier],
      () => true,
    );
    expect(rounds.map((round) => [round.precision, round.decidedAt])).toEqual([
      ['legacy', DECIDED_AT],
      ['pinned', sentBackLater.decidedAt],
      ['legacy', null],
    ]);
    expect(rounds[rounds.length - 1]).toMatchObject({ state: 'AWAITING_DECISION', sentAt: null });
  });

  // A waiting answer whose send time is recorded sorts by that time: that is how round-3 code
  // read it too, so a test of it guards nothing new and is not kept here.

  it('places a decision with no send time by its decision time, before a later send', () => {
    // An older decision with no exact send behind it, then an exact send decided later.
    const send: StoredSend = {
      id: 'send-1',
      requestId: 'request-1',
      roundNo: 1,
      sentAt: new Date(DECIDED_AT.getTime() + 60 * 60 * 1000),
      subjectId: 'document-a',
      versionId: 'version-a',
      intact: true,
    };
    const accepted: StoredDecision = {
      id: 'decision-2',
      requestId: 'request-1',
      outcome: 'ACCEPTED',
      decidedAt: new Date(DECIDED_AT.getTime() + 2 * 60 * 60 * 1000),
      subjectId: 'document-a',
      sendId: send.id,
    };
    const request: RoundRequest = {
      id: 'request-1',
      status: 'ACCEPTED',
      respondingId: 'document-a',
      respondedAt: null,
    };
    const latest = latestRoundOf(request, [send], [sentBackEarlier, accepted], () => true);
    expect(latest).toMatchObject({ precision: 'pinned', state: 'ACCEPTED' });
    expect(
      classifySend({
        standing: requestStanding(request.status),
        latest: latest ? { state: latest.state, carries: 'EARLIER' } : null,
        liveWork: true,
        waitsEvenOnCurrent: false,
      }),
    ).toBe('AGENCY_ACCEPTED_EARLIER_LIVE_WORK');
  });
});
