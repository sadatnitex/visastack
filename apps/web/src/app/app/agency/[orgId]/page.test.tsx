import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  loadOrgAccess: vi.fn(),
  loadMembers: vi.fn(),
  loadEvidenceRequests: vi.fn(),
  loadCases: vi.fn(),
  loadApplicants: vi.fn(),
  loadUnassignedQueue: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('./console-data', () => mocks);

const { default: Page } = await import('./page');

const pageProps = (search: Record<string, string> = {}) => ({
  params: Promise.resolve({ orgId: 'o1' }),
  searchParams: Promise.resolve(search),
});

const PAST = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const LATER = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

const needsAttention = {
  missionId: 'm1',
  applicantId: 'ap1',
  applicantName: 'Rahim Uddin',
  title: 'UK Standard Visitor',
  state: 'DRAFT',
  destination: 'United Kingdom',
  manualMode: false,
  packVersionId: 'pv1',
  targetDeadline: null,
  travelStartDate: null,
  assignments: [],
  notes: [],
  tasks: [{ status: 'OPEN', dueDate: PAST }],
  readiness: { ready: false, requiredCount: 5, satisfiedRequired: 3 },
  liveAcknowledgementAt: null,
};
const inGoodShape = {
  missionId: 'm2',
  applicantId: 'ap2',
  applicantName: 'Nusrat Jahan',
  title: 'Schengen Short Stay',
  state: 'DRAFT',
  destination: 'France',
  manualMode: false,
  packVersionId: 'pv2',
  targetDeadline: null,
  travelStartDate: null,
  assignments: [{ memberAccountId: 'acct-1', memberEmail: 'me@example.com' }],
  notes: [{ id: 'n1' }],
  tasks: [{ status: 'OPEN', dueDate: LATER }],
  readiness: { ready: true, requiredCount: 4, satisfiedRequired: 4 },
  liveAcknowledgementAt: '2026-10-01T00:00:00.000Z',
};

function asAdmin() {
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([{ accountId: 'acct-1', email: 'me@example.com' }]);
  mocks.loadEvidenceRequests.mockResolvedValue([
    { id: 'r1', applicantId: 'ap1', status: 'OPEN' },
    { id: 'r2', applicantId: 'ap1', status: 'NEEDS_REPLACEMENT' },
    { id: 'r3', applicantId: 'ap2', status: 'ACCEPTED' },
  ]);
  mocks.loadApplicants.mockResolvedValue([{ id: 'ap1' }, { id: 'ap2' }]);
  mocks.loadCases.mockResolvedValue({ admin: true, cases: [inGoodShape, needsAttention] });
  mocks.loadUnassignedQueue.mockResolvedValue([
    { missionId: 'm1', title: 'UK Standard Visitor', applicantName: 'Rahim Uddin' },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1';
  asAdmin();
});

describe('agency Dashboard', () => {
  it('shows an administrator the four counts, each agreeing with the case list below', async () => {
    const text = textOf(await renderServer(Page(pageProps())));
    expect(text).toContain('What Needs You First');
    expect(text).toMatch(/Cases you can see 2/);
    expect(text).toMatch(/Cases with Nobody Assigned 1/);
    // WP-V4 review: an open request and one sent back for a fix both wait on the applicant.
    expect(text).toMatch(/Evidence Requests Waiting on the Applicant 2/);
    expect(text).toMatch(/Overdue Tasks 1/);
  });

  it('puts the case that needs the most attention first', async () => {
    const html = await renderServer(Page(pageProps()));
    expect(html.indexOf('Rahim Uddin')).toBeLessThan(html.indexOf('Nusrat Jahan'));
    const text = textOf(html);
    expect(text).toContain('Needs Assignment');
    expect(text).toContain('1 open request');
    expect(text).toContain('1 needs replacement');
    expect(text).toContain('1 overdue task');
    expect(text).toContain('Assigned to You');
    expect(text).toContain('2 missing');
    expect(text).toContain('Ready');
  });

  it('opens a case in its workspace on the Cases tab, not on the traveller-only case page', async () => {
    const html = await renderServer(Page(pageProps()));
    expect(html).toContain('href="/app/agency/o1/cases#mission-m1"');
    expect(html).toContain('href="/app/agency/o1/cases#mission-m2"');
    expect(html).not.toContain('href="/app/mission/');
  });

  it('lists the reassignment queue for an administrator, linking to each case workspace', async () => {
    const html = await renderServer(Page(pageProps()));
    expect(textOf(html)).toContain('Reassignment Queue');
    expect(html).toMatch(/<a href="\/app\/agency\/o1\/cases#mission-m1" class="row row-link">/);
  });

  it('leaves out the queue when nothing is unassigned', async () => {
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    expect(textOf(await renderServer(Page(pageProps())))).not.toContain('Reassignment Queue');
  });

  it('tells a member who is not an administrator what they can do, and hides what they cannot', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    mocks.loadMembers.mockResolvedValue([]);
    mocks.loadEvidenceRequests.mockResolvedValue([]);
    mocks.loadCases.mockResolvedValue({ admin: false, cases: [inGoodShape] });
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    const text = textOf(await renderServer(Page(pageProps())));
    expect(text).toContain("You're a member of this organization but not an administrator");
    expect(text).toMatch(/Cases you can see 1/);
    expect(text).not.toContain('Cases with Nobody Assigned');
    expect(text).not.toContain('Evidence Requests Waiting on the Applicant');
    expect(text).toMatch(/Overdue Tasks 0/);
    expect(text).not.toContain('Reassignment Queue');
  });

  it('renders nothing, and reads nothing further, for someone with no role', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: false });
    expect(await renderServer(Page(pageProps()))).toBe('');
    expect(mocks.loadCases).not.toHaveBeenCalled();
    expect(mocks.loadMembers).not.toHaveBeenCalled();
  });

  it('renders nothing for an organization that does not exist', async () => {
    mocks.loadOrgAccess.mockResolvedValue(null);
    expect(await renderServer(Page(pageProps()))).toBe('');
    expect(mocks.loadCases).not.toHaveBeenCalled();
  });

  it('searches only the cases already loaded, by name, title or id', async () => {
    // The reassignment queue is separate from the search; empty it so the list is all that is left.
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    const byName = textOf(await renderServer(Page(pageProps({ q: 'nusrat' }))));
    expect(byName).toContain('Nusrat Jahan');
    expect(byName).not.toContain('Rahim Uddin');
    const byId = textOf(await renderServer(Page(pageProps({ q: 'm1' }))));
    expect(byId).toContain('Rahim Uddin');
    expect(byId).not.toContain('Nusrat Jahan');
  });

  it('filters by destination and by assignee', async () => {
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    const france = textOf(await renderServer(Page(pageProps({ destination: 'fra' }))));
    expect(france).toContain('Nusrat Jahan');
    expect(france).not.toContain('Rahim Uddin');
    const mine = textOf(await renderServer(Page(pageProps({ assignee: 'acct-1' }))));
    expect(mine).toContain('Nusrat Jahan');
    expect(mine).not.toContain('Rahim Uddin');
  });

  it('narrows the list with one-tap views and shows how many cases each holds', async () => {
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    const all = textOf(await renderServer(Page(pageProps())));
    expect(all).toContain('Mine 1');
    expect(all).toContain('Overdue 1');
    expect(all).toContain('Waiting on Traveller 1');
    expect(all).toContain('Unassigned 1');
    for (const [quick, shown, hidden] of [
      ['mine', 'Nusrat Jahan', 'Rahim Uddin'],
      ['overdue', 'Rahim Uddin', 'Nusrat Jahan'],
      ['waiting', 'Rahim Uddin', 'Nusrat Jahan'],
      ['unassigned', 'Rahim Uddin', 'Nusrat Jahan'],
    ] as const) {
      const text = textOf(await renderServer(Page(pageProps({ quick }))));
      expect(text, quick).toContain(shown);
      expect(text, quick).not.toContain(hidden);
    }
  });

  it('keeps the search when a quick view is chosen and shows a deadline column', async () => {
    const html = await renderServer(Page(pageProps({ q: 'rahim' })));
    expect(html).toContain('quick=overdue');
    expect(html).toContain('q=rahim');
    expect(textOf(html)).toContain('Deadline');
    expect(textOf(html)).toContain('Not set');
  });

  it('says so when a search matches nothing', async () => {
    const text = textOf(await renderServer(Page(pageProps({ q: 'no such case' }))));
    expect(text).toContain('No cases match that search.');
  });

  it('explains an empty inbox differently for an administrator and a member', async () => {
    mocks.loadApplicants.mockResolvedValue([{ id: 'ap1' }, { id: 'ap2' }]);
    mocks.loadCases.mockResolvedValue({ admin: true, cases: [] });
    expect(textOf(await renderServer(Page(pageProps())))).toContain(
      'No cases are reachable yet - an applicant must grant this organization access',
    );
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    mocks.loadCases.mockResolvedValue({ admin: false, cases: [] });
    expect(textOf(await renderServer(Page(pageProps())))).toContain(
      "You aren't assigned to any cases yet",
    );
  });
});

describe('agency Dashboard: Do Next (WP-V4)', () => {
  const pastDue = {
    id: 'r-late',
    applicantId: 'ap2',
    applicantName: 'Nusrat Jahan',
    missionId: 'm2',
    kind: 'DOCUMENT',
    docType: 'BANK_STATEMENT',
    fieldKey: null,
    message: null,
    status: 'OPEN',
    dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    respondedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    requestedByAccountId: 'acct-1',
  };

  it('shows an administrator a past-due request first, with owner, reason and a follow-up message to review', async () => {
    mocks.loadEvidenceRequests.mockResolvedValue([pastDue]);
    const html = await renderServer(Page(pageProps()));
    const text = textOf(html);
    expect(text).toContain('Do Next');
    const doNext = html.slice(
      html.indexOf('id="do-next-heading"'),
      html.indexOf('id="pipeline-heading"'),
    );
    expect(doNext.indexOf('Bank Statement')).toBeGreaterThan(-1);
    // Past due comes before the overdue-task case.
    expect(doNext.indexOf('Bank Statement')).toBeLessThan(doNext.indexOf('UK Standard Visitor'));
    // The viewer is assigned to that case, so they own it.
    expect(textOf(doNext)).toContain('Owner You');
    expect(textOf(doNext)).toMatch(/Why Was due .+ and has not arrived\./);
    expect(textOf(doNext)).toContain('Review Follow-Up Message');
    expect(doNext).toContain('What we need: Bank Statement');
    expect(doNext).not.toContain('r-late');
  });

  it('gives a member who is not an administrator no request items and no error, only their overdue tasks', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    mocks.loadMembers.mockResolvedValue([]);
    // Even if a request reached the page, Do Next would not show it to a member.
    mocks.loadEvidenceRequests.mockResolvedValue([pastDue]);
    mocks.loadCases.mockResolvedValue({ admin: false, cases: [needsAttention] });
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    const html = await renderServer(Page(pageProps()));
    const doNext = textOf(
      html.slice(html.indexOf('id="do-next-heading"'), html.indexOf('id="pipeline-heading"')),
    );
    expect(doNext).toContain('Overdue tasks on the cases assigned to you');
    expect(doNext).toContain('UK Standard Visitor');
    expect(doNext).toContain('1 task is past due.');
    expect(doNext).not.toContain('Bank Statement');
    expect(doNext).not.toContain('Review Follow-Up Message');
    expect(doNext).not.toContain('Assign Someone');
  });

  it('says plainly when nothing needs doing first', async () => {
    mocks.loadEvidenceRequests.mockResolvedValue([]);
    mocks.loadCases.mockResolvedValue({ admin: true, cases: [inGoodShape] });
    expect(textOf(await renderServer(Page(pageProps())))).toContain(
      'Nothing needs you first right now.',
    );
  });

  it('counts a request that names a case on that case only, and a sent-back one as waiting on the traveller', async () => {
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    const sibling = { ...needsAttention, missionId: 'm3', title: 'Canada Visitor', tasks: [] };
    mocks.loadCases.mockResolvedValue({ admin: true, cases: [needsAttention, sibling] });
    mocks.loadEvidenceRequests.mockResolvedValue([
      { id: 'r1', applicantId: 'ap1', missionId: 'm3', status: 'NEEDS_REPLACEMENT' },
    ]);
    const text = textOf(await renderServer(Page(pageProps())));
    expect(text).toContain('Waiting on Traveller 1');
    const waiting = textOf(await renderServer(Page(pageProps({ quick: 'waiting' }))));
    expect(waiting).toContain('Canada Visitor');
    expect(waiting).not.toMatch(/Rahim Uddin · UK Standard Visitor/);
  });
});

describe('agency Dashboard: counts and Do Next agree (WP-V4 review)', () => {
  it('never says nothing needs a response while Do Next lists an item', async () => {
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    mocks.loadCases.mockResolvedValue({ admin: true, cases: [inGoodShape] });
    mocks.loadEvidenceRequests.mockResolvedValue([
      {
        id: 'r-in',
        applicantId: 'ap2',
        missionId: 'm2',
        kind: 'DOCUMENT',
        docType: 'PASSPORT',
        status: 'RECEIVED',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ]);
    const listed = textOf(await renderServer(Page(pageProps())));
    expect(listed).toContain('Waiting for Review');
    expect(listed).not.toContain('Nothing is overdue, unassigned or waiting on an applicant');
    mocks.loadEvidenceRequests.mockResolvedValue([]);
    const empty = textOf(await renderServer(Page(pageProps())));
    expect(empty).toContain('Nothing needs you first right now.');
    expect(empty).toContain('Nothing is overdue, unassigned or waiting on an applicant');
  });

  it('counts a sent-back request in the waiting number, the Waiting on Traveller view and Do Next alike', async () => {
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    mocks.loadCases.mockResolvedValue({ admin: true, cases: [inGoodShape] });
    mocks.loadEvidenceRequests.mockResolvedValue([
      {
        id: 'r-back',
        applicantId: 'ap2',
        missionId: 'm2',
        kind: 'DOCUMENT',
        docType: 'PASSPORT',
        status: 'NEEDS_REPLACEMENT',
        dueDate: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ]);
    const text = textOf(await renderServer(Page(pageProps())));
    expect(text).toMatch(/Evidence Requests Waiting on the Applicant 1/);
    expect(text).toContain('Waiting on Traveller 1');
    expect(text).toMatch(/Sent back for a fix and was due/);
  });
});

describe('agency Dashboard: file states for triage (WP-V4 re-review)', () => {
  it("asks for the answered files' state, which Do Next uses", async () => {
    await renderServer(Page(pageProps()));
    expect(mocks.loadEvidenceRequests.mock.calls[0]?.[4]).toEqual({ withFileStates: true });
  });
});
