import { describe, expect, it } from 'vitest';
import {
  APPROACHING_DAYS,
  EVIDENCE_DECIDABLE_STATUSES,
  ORG_STATUS,
  REQ_STATUS,
  countOverdueTasks,
  nextApproachingDate,
  summarizeAttention,
} from './console-format';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

describe('nextApproachingDate', () => {
  it('returns nothing when no date is set', () => {
    expect(nextApproachingDate(null, null, NOW.getTime())).toBeNull();
  });

  it('returns the soonest of the two dates inside the horizon', () => {
    expect(nextApproachingDate(days(10), days(3), NOW.getTime())).toEqual({
      label: 'Travel',
      date: days(3),
    });
    expect(nextApproachingDate(days(2), days(9), NOW.getTime())).toEqual({
      label: 'Deadline',
      date: days(2),
    });
  });

  it('ignores a date in the past and a date beyond the horizon', () => {
    expect(nextApproachingDate(days(-1), null, NOW.getTime())).toBeNull();
    expect(nextApproachingDate(days(APPROACHING_DAYS + 1), null, NOW.getTime())).toBeNull();
  });

  it('includes a date exactly on either edge of the window', () => {
    expect(nextApproachingDate(NOW.toISOString(), null, NOW.getTime())?.label).toBe('Deadline');
    expect(nextApproachingDate(days(APPROACHING_DAYS), null, NOW.getTime())?.label).toBe(
      'Deadline',
    );
  });
});

describe('countOverdueTasks', () => {
  it('counts only open tasks that are past their due date', () => {
    expect(
      countOverdueTasks(
        [
          { status: 'OPEN', dueDate: days(-2) },
          { status: 'OPEN', dueDate: days(2) },
          { status: 'OPEN', dueDate: null },
          { status: 'DONE', dueDate: days(-5) },
          { status: 'CANCELLED', dueDate: days(-5) },
          { status: 'OPEN', dueDate: days(-1) },
        ],
        NOW,
      ),
    ).toBe(2);
  });
});

describe('summarizeAttention', () => {
  const overdue = { status: 'OPEN', dueDate: days(-3) };
  const later = { status: 'OPEN', dueDate: days(3) };
  const cases = [
    { assignments: [], tasks: [overdue, later] },
    { assignments: [{}], tasks: [overdue, overdue] },
    { assignments: [{}, {}], tasks: [] },
  ];
  const requests = [
    { status: 'OPEN' },
    { status: 'OPEN' },
    { status: 'RECEIVED' },
    { status: 'ACCEPTED' },
  ];

  it('gives an administrator all four counts', () => {
    expect(summarizeAttention({ admin: true, cases, requests, now: NOW })).toEqual({
      cases: 3,
      needAssignment: 1,
      openRequests: 2,
      overdueTasks: 3,
    });
  });

  it('tells a member who cannot assign or see requests only what they can act on', () => {
    expect(summarizeAttention({ admin: false, cases, requests, now: NOW })).toEqual({
      cases: 3,
      needAssignment: null,
      openRequests: null,
      overdueTasks: 3,
    });
  });

  it('reports zeros, not blanks, for an administrator with nothing to do', () => {
    expect(summarizeAttention({ admin: true, cases: [], requests: [], now: NOW })).toEqual({
      cases: 0,
      needAssignment: 0,
      openRequests: 0,
      overdueTasks: 0,
    });
  });
});

describe('status vocabularies', () => {
  it('labels every organization status the service can store', () => {
    for (const status of ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'CLOSED']) {
      expect(ORG_STATUS[status]?.label, status).toBeTruthy();
    }
  });

  it('labels every evidence-request status, and only submitted work can be decided', () => {
    for (const status of [
      'OPEN',
      'RECEIVED',
      'UNDER_REVIEW',
      'ACCEPTED',
      'NEEDS_REPLACEMENT',
      'CANCELLED',
      'FULFILLED',
      'DECLINED',
    ]) {
      expect(REQ_STATUS[status]?.label, status).toBeTruthy();
    }
    expect([...EVIDENCE_DECIDABLE_STATUSES].sort()).toEqual(['RECEIVED', 'UNDER_REVIEW']);
  });
});
