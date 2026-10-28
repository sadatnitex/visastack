import type { CaseTriageItem } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { caseNeedsYou } from './case-needs';

const item = (over: Partial<CaseTriageItem>): CaseTriageItem => ({
  key: 'k',
  kind: 'DOCUMENT',
  subject: null,
  packRequirementId: null,
  requestId: null,
  group: 'RECEIVED',
  indicators: [],
  dueDate: null,
  ...over,
});

const base = {
  viewerAccountId: 'me',
  admin: false,
  state: 'DRAFT',
  viewerAssigned: true,
  assignmentCount: 1,
  tasks: [] as { status: string; assigneeAccountId: string | null }[],
  triage: { items: [] as CaseTriageItem[] },
};

describe('what on a case needs this person (Agency Cases, Glance)', () => {
  it('counts only open tasks assigned to this person', () => {
    expect(
      caseNeedsYou({
        ...base,
        tasks: [
          { status: 'OPEN', assigneeAccountId: 'me' },
          { status: 'IN_PROGRESS', assigneeAccountId: 'me' },
          { status: 'DONE', assigneeAccountId: 'me' },
          { status: 'CANCELLED', assigneeAccountId: 'me' },
          { status: 'OPEN', assigneeAccountId: 'someone-else' },
          { status: 'OPEN', assigneeAccountId: null },
        ],
      }),
    ).toBe('Needs you: 2 tasks.');
  });

  it('counts sent items waiting for review, and only those', () => {
    expect(
      caseNeedsYou({
        ...base,
        triage: {
          items: [
            item({ group: 'RECEIVED' }),
            item({ group: 'MISSING' }),
            item({ group: 'NEEDS_CORRECTION' }),
            item({ group: 'REVIEWED' }),
            item({ group: 'PROCESSING' }),
          ],
        },
      }),
    ).toBe('Needs you: 1 item to review.');
  });

  it('leaves checklist reviews to the people assigned, who alone can record a decision', () => {
    const triage = { items: [item({}), item({ requestId: 'r1' })] };
    // An administrator not on the case reviews replies to requests, not checklist items.
    expect(caseNeedsYou({ ...base, admin: true, viewerAssigned: false, triage })).toBe(
      'Needs you: 1 item to review.',
    );
    expect(caseNeedsYou({ ...base, viewerAssigned: false, triage })).toBe(
      'Nothing needs you on this case right now.',
    );
  });

  it('asks an administrator to give a case nobody looks after an owner', () => {
    expect(
      caseNeedsYou({
        ...base,
        admin: true,
        viewerAssigned: false,
        assignmentCount: 0,
        tasks: [{ status: 'OPEN', assigneeAccountId: 'me' }],
        triage: { items: [item({ requestId: 'r1' })] },
      }),
    ).toBe('Needs you: 1 task, 1 item to review and someone to look after it.');
    expect(caseNeedsYou({ ...base, viewerAssigned: false, assignmentCount: 0 })).toBe(
      'Nothing needs you on this case right now.',
    );
  });

  it('asks nothing of a closed, cancelled or submitted case, as Agency Overview', () => {
    for (const state of ['CLOSED', 'CANCELLED', 'SUBMITTED']) {
      expect(
        caseNeedsYou({
          ...base,
          admin: true,
          state,
          assignmentCount: 0,
          tasks: [{ status: 'OPEN', assigneeAccountId: 'me' }],
          triage: { items: [item({})] },
        }),
      ).toBe('Nothing needs you on this case right now.');
    }
  });
});
