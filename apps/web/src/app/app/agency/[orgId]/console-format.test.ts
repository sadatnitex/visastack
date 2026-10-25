import { describe, expect, it } from 'vitest';
import {
  APPROACHING_DAYS,
  EVIDENCE_DECIDABLE_STATUSES,
  ORG_STATUS,
  REQ_STATUS,
  countOverdueTasks,
  nextApproachingDate,
  overdueTasks,
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

describe('overdue tasks include started ones (WP-V4, W0 ledger H4)', () => {
  it('counts a started task past its due date, as the reminder emails do', () => {
    expect(
      countOverdueTasks(
        [
          { status: 'IN_PROGRESS', dueDate: days(-1) },
          { status: 'IN_PROGRESS', dueDate: days(1) },
          { status: 'OPEN', dueDate: days(-3) },
          { status: 'DONE', dueDate: days(-3) },
        ],
        NOW,
      ),
    ).toBe(2);
  });

  it('returns the overdue tasks themselves for callers that need their dates', () => {
    const late = { status: 'IN_PROGRESS', dueDate: days(-4), id: 't1' };
    expect(overdueTasks([late, { status: 'OPEN', dueDate: null, id: 't2' }], NOW)).toEqual([late]);
  });
});

describe('dashboard counts agree with Do Next (WP-V4 review)', () => {
  it('counts open and sent-back requests as waiting on the applicant', () => {
    expect(
      summarizeAttention({
        admin: true,
        cases: [],
        requests: [
          { status: 'OPEN' },
          { status: 'NEEDS_REPLACEMENT' },
          { status: 'RECEIVED' },
          { status: 'ACCEPTED' },
        ],
        now: NOW,
      }).openRequests,
    ).toBe(2);
  });

  it('treats a due date as a calendar day: a task due today is not past due until the day ends', () => {
    const today = '2026-10-05T00:00:00.000Z';
    const yesterday = '2026-10-04T00:00:00.000Z';
    const lateTonight = new Date('2026-10-05T23:59:00.000Z');
    expect(countOverdueTasks([{ status: 'OPEN', dueDate: today }], lateTonight)).toBe(0);
    expect(countOverdueTasks([{ status: 'OPEN', dueDate: yesterday }], lateTonight)).toBe(1);
    expect(
      countOverdueTasks(
        [{ status: 'IN_PROGRESS', dueDate: today }],
        new Date('2026-10-06T00:01:00.000Z'),
      ),
    ).toBe(1);
  });
});
