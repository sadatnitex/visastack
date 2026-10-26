import { daysUntilDueDay } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { overdueTasks } from '../../../agency/[orgId]/console-format';
import { type DoNextInput, buildDoNext } from '../../../agency/[orgId]/do-next';
import { dueLabel } from './due-label';

/*
 * Owner decision, 26 Oct 2026 (ADR 0015 amendment, ADR 0016): the traveller's time zone decides
 * when an agency request is past due, on the traveller's Home, the traveller's evidence page and
 * the agency's Do Next list. One day rule (`daysUntilDueDay`), read three ways, must agree.
 */

const DUE = '2026-10-26T00:00:00.000Z';

const CASES = [
  // 23:59 and 00:01 local time either side of the end of 26 Oct.
  { zone: 'Asia/Dhaka', before: '2026-10-26T17:59:00Z', after: '2026-10-26T18:01:00Z' },
  {
    zone: 'America/Los_Angeles',
    before: '2026-10-27T06:59:00Z',
    after: '2026-10-27T07:01:00Z',
  },
] as const;

/** Home: the item's due state comes from `daysUntilDueDay` in the traveller's zone. */
const homePastDue = (zone: string, now: Date) => daysUntilDueDay(new Date(DUE), now, zone) < 0;

const evidencePastDue = (zone: string, now: Date) =>
  dueLabel(DUE, 'OPEN', zone, now)?.tone === 'danger';

function doNextInput(zone: string, now: Date): DoNextInput {
  return {
    admin: true,
    viewerAccountId: 'viewer',
    cases: [
      {
        missionId: 'case-1',
        applicantId: 'traveller-1',
        applicantName: 'Synthetic Traveller',
        applicantTimezone: zone,
        title: 'Japan Visit',
        state: 'IN_PROGRESS',
        assignments: [{ memberAccountId: 'viewer', memberEmail: 'viewer@example.com' }],
        tasks: [{ status: 'OPEN', dueDate: DUE }],
      },
    ],
    requests: [
      {
        id: 'request-1',
        applicantId: 'traveller-1',
        applicantName: 'Synthetic Traveller',
        applicantTimezone: zone,
        kind: 'DOCUMENT',
        docType: 'BANK_STATEMENT',
        status: 'OPEN',
        dueDate: DUE,
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    applicantWide: 'all',
    members: [],
    organizationName: 'Harbor Visas',
    base: '/app/agency/org-1',
    now,
  };
}

const doNextPastDue = (zone: string, now: Date) =>
  buildDoNext(doNextInput(zone, now)).some((item) => item.key === 'request:request-1');

describe('past due follows the traveller time zone everywhere', () => {
  for (const { zone, before, after } of CASES) {
    it(`${zone}: not past due at 23:59 on the due day, past due at 00:01 the next day`, () => {
      for (const [at, expected] of [
        [before, false],
        [after, true],
      ] as const) {
        const now = new Date(at);
        expect([
          homePastDue(zone, now),
          evidencePastDue(zone, now),
          doNextPastDue(zone, now),
        ]).toEqual([expected, expected, expected]);
      }
    });

    it(`${zone}: an agency task due that day turns overdue at the same moment`, () => {
      const task = { status: 'OPEN', dueDate: DUE };
      const tasks = [task];
      expect(overdueTasks(tasks, new Date(before), zone)).toHaveLength(0);
      expect(overdueTasks(tasks, new Date(after), zone)).toHaveLength(1);
      // A task's own time zone wins over the traveller's.
      expect(
        overdueTasks([{ ...task, dueTimezone: 'Pacific/Kiritimati' }], new Date(before), zone),
      ).toHaveLength(1);
      const row3 = (at: string) =>
        buildDoNext({ ...doNextInput(zone, new Date(at)), requests: [] }).some(
          (item) => item.key === 'case:case-1' && item.tier === 3,
        );
      expect([row3(before), row3(after)]).toEqual([false, true]);
    });
  }

  it('the evidence page words the day plainly and never shows minus zero', () => {
    const { zone, before, after } = CASES[1];
    expect(dueLabel(DUE, 'OPEN', zone, new Date(before))).toEqual({
      label: 'Due Today',
      tone: 'warning',
    });
    expect(dueLabel(DUE, 'NEEDS_REPLACEMENT', zone, new Date(after))).toEqual({
      label: 'Overdue by 1 day',
      tone: 'danger',
    });
    // Answered or closed requests have no deadline status.
    expect(dueLabel(DUE, 'RECEIVED', zone, new Date(after))).toBeNull();
    // Without a known zone, UTC.
    expect(dueLabel(DUE, 'OPEN', null, new Date('2026-10-26T23:59:00Z'))?.label).toBe('Due Today');
  });
});
