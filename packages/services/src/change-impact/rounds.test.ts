import { describe, expect, it } from 'vitest';
import { classifySend, requestStanding } from './classify';
import { type RoundRequest, type StoredDecision, latestRoundOf } from './rounds';

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
  });

  it('reads the same answer the same way when its send time is recorded after the decision', () => {
    const { latest, reason } = judged({
      id: 'request-1',
      status: 'RECEIVED',
      respondingId: 'document-a',
      respondedAt: new Date(DECIDED_AT.getTime() + 60 * 60 * 1000),
    });
    expect(latest?.state).toBe('AWAITING_DECISION');
    expect(reason).toBe('AGENCY_CHECKING_EARLIER');
  });

  it('keeps a decision with no send time in its place by its decision time', () => {
    // Nothing waits: the sent-back decision is the latest round.
    const { latest, reason } = judged({
      id: 'request-1',
      status: 'NEEDS_REPLACEMENT',
      respondingId: 'document-a',
      respondedAt: null,
    });
    expect(latest).toMatchObject({ precision: 'legacy', state: 'SENT_BACK', sentAt: null });
    expect(reason).toBe('AGENCY_WAITING_FOR_REPLACEMENT');
  });
});
