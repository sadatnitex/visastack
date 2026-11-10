import type { CaseTriageItem } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { caseNeedsYou, caseReviewLink } from './case-needs';

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
    ).toBe('Needs you: 1 task, 1 item to review and no owner set.');
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

describe('the count of items to review leads to the request (friction register E4)', () => {
  const admin = { ...base, admin: true, viewerAssigned: false, base: '/app/agency/o1' };

  it('links the count to the exact request, on the anchor emails and Do Next already use', () => {
    const triage = { items: [item({}), item({ requestId: 'r-7' }), item({ requestId: 'r-8' })] };
    expect(caseReviewLink({ ...admin, triage })).toEqual({
      phrase: '2 items to review',
      href: '/app/agency/o1/clients?request=r-7#request-r-7',
    });
  });

  it('names a phrase that is inside the sentence the screen shows', () => {
    const triage = { items: [item({ requestId: 'r-7' })] };
    const link = caseReviewLink({ ...admin, triage });
    expect(caseNeedsYou({ ...admin, triage })).toContain(link?.phrase ?? 'missing');
  });

  it('gives no link when only checklist items wait, which no request holds', () => {
    expect(caseReviewLink({ ...admin, triage: { items: [item({})] } })).toBeNull();
  });

  it('gives no link to a member who is not an administrator', () => {
    const triage = { items: [item({ requestId: 'r-7' })] };
    expect(caseReviewLink({ ...admin, admin: false, viewerAssigned: true, triage })).toBeNull();
  });

  it('ignores replies that are not waiting for review', () => {
    const triage = {
      items: [
        item({ requestId: 'r-1', group: 'MISSING' }),
        item({ requestId: 'r-2', group: 'REVIEWED' }),
      ],
    };
    expect(caseReviewLink({ ...admin, triage })).toBeNull();
  });

  it('gives no link on a closed case', () => {
    const triage = { items: [item({ requestId: 'r-7' })] };
    expect(caseReviewLink({ ...admin, state: 'CLOSED', triage })).toBeNull();
  });
});
