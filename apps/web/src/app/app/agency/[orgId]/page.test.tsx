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
    expect(text).toMatch(/Evidence Requests Waiting on the Applicant 1/);
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
