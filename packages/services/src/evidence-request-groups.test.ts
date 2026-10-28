import { schema } from '@visastack/db';
import { describe, expect, it } from 'vitest';
import { evidenceRequestTriageGroup } from './agency';
import { ATTENTION_REQUEST_STATUSES, WITH_AGENCY_REQUEST_STATUSES } from './attention';
import {
  PENDING_REQUEST_STATUSES,
  WAITING_ON_AGENCY_REQUEST_STATUSES,
  WAITING_ON_TRAVELLER_REQUEST_STATUSES,
  countPendingRequests,
  isWaitingOnAgency,
  isWaitingOnTraveller,
} from './evidence-request-groups';

// Every status the database can store, read from the real enum so a new status cannot be missed.
const ALL_STATUSES: string[] = [...schema.evidenceRequestStatus.enumValues];

const request = (status: string) => ({ status });

describe('which evidence requests are pending (owner decision D4)', () => {
  it('knows all eight real request statuses', () => {
    expect([...ALL_STATUSES].sort()).toEqual(
      [
        'ACCEPTED',
        'CANCELLED',
        'DECLINED',
        'FULFILLED',
        'NEEDS_REPLACEMENT',
        'OPEN',
        'RECEIVED',
        'UNDER_REVIEW',
      ].sort(),
    );
  });

  it('puts exactly open and sent-back requests in the traveller group', () => {
    const members = ALL_STATUSES.filter((status) => isWaitingOnTraveller(status));
    expect(members.sort()).toEqual(['NEEDS_REPLACEMENT', 'OPEN']);
    expect([...WAITING_ON_TRAVELLER_REQUEST_STATUSES].sort()).toEqual([
      'NEEDS_REPLACEMENT',
      'OPEN',
    ]);
  });

  it('puts exactly received and under-review requests in the agency group', () => {
    const members = ALL_STATUSES.filter((status) => isWaitingOnAgency(status));
    expect(members.sort()).toEqual(['RECEIVED', 'UNDER_REVIEW']);
    expect([...WAITING_ON_AGENCY_REQUEST_STATUSES].sort()).toEqual(['RECEIVED', 'UNDER_REVIEW']);
  });

  it('keeps the two groups apart and leaves out every closed status', () => {
    for (const status of ALL_STATUSES) {
      expect(isWaitingOnTraveller(status) && isWaitingOnAgency(status), status).toBe(false);
    }
    const closed = ALL_STATUSES.filter(
      (status) => !isWaitingOnTraveller(status) && !isWaitingOnAgency(status),
    );
    expect(closed.sort()).toEqual(['ACCEPTED', 'CANCELLED', 'DECLINED', 'FULFILLED']);
    expect([...PENDING_REQUEST_STATUSES].sort()).toEqual(
      ['NEEDS_REPLACEMENT', 'OPEN', 'RECEIVED', 'UNDER_REVIEW'].sort(),
    );
  });

  it('does not treat the made-up Submitted status as pending', () => {
    expect(PENDING_REQUEST_STATUSES as readonly string[]).not.toContain('SUBMITTED');
    expect(countPendingRequests([request('SUBMITTED')]).pending).toBe(0);
  });

  it('counts one request in every status: pending is travellers plus agency, nothing more', () => {
    const counts = countPendingRequests(ALL_STATUSES.map(request));
    expect(counts).toEqual({ pending: 4, waitingOnTravellers: 2, waitingOnAgency: 2 });
    expect(counts.pending).toBe(counts.waitingOnTravellers + counts.waitingOnAgency);
  });

  it('counts each status on its own into the right part', () => {
    for (const status of ALL_STATUSES) {
      const counts = countPendingRequests([request(status)]);
      expect(counts.waitingOnTravellers, status).toBe(isWaitingOnTraveller(status) ? 1 : 0);
      expect(counts.waitingOnAgency, status).toBe(isWaitingOnAgency(status) ? 1 : 0);
      expect(counts.pending, status).toBe(counts.waitingOnTravellers + counts.waitingOnAgency);
    }
    expect(countPendingRequests([])).toEqual({
      pending: 0,
      waitingOnTravellers: 0,
      waitingOnAgency: 0,
    });
  });

  it('is the same list the traveller side and the database queries already use', () => {
    expect([...ATTENTION_REQUEST_STATUSES]).toEqual([...WAITING_ON_TRAVELLER_REQUEST_STATUSES]);
    expect([...WITH_AGENCY_REQUEST_STATUSES]).toEqual([...WAITING_ON_AGENCY_REQUEST_STATUSES]);
  });

  it('agrees with the triage groups: travellers owe Missing or Needs Correction, the agency owes Received', () => {
    for (const status of ALL_STATUSES) {
      const group = evidenceRequestTriageGroup({
        status,
        kind: 'DOCUMENT',
      } as Parameters<typeof evidenceRequestTriageGroup>[0]);
      if (isWaitingOnTraveller(status)) {
        expect(['MISSING', 'NEEDS_CORRECTION'], status).toContain(group);
      } else if (isWaitingOnAgency(status)) {
        expect(group, status).toBe('RECEIVED');
      } else {
        expect(['REVIEWED', null], status).toContain(group);
      }
    }
  });
});
