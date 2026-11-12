import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';
import { missingBengali } from '../agency-bn.test-support';

// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const mocks = vi.hoisted(() => ({
  loadOrgAccess: vi.fn(),
  loadMembers: vi.fn(),
  loadEvidenceRequests: vi.fn(),
  loadCases: vi.fn(),
  loadApplicants: vi.fn(),
  loadUnassignedQueue: vi.fn(),
  loadClientsJoined: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./console-data', () => mocks);
vi.mock('./billing-status-notice', () => ({
  BillingStatusNotice: () => null,
  loadBillingNotice: async () => null,
}));
vi.mock('./follow-up-copy', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { FollowUpCopy: stub('FollowUpCopy') };
});

const { default: Page } = await import('./page');

const pageProps = (search: Record<string, string> = {}) => ({
  params: Promise.resolve({ orgId: 'o1' }),
  searchParams: Promise.resolve(search),
});

const PAST = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const LATER = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const SOON = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const base = {
  applicantId: 'ap1',
  title: 'UK Standard Visitor',
  state: 'DRAFT',
  destination: 'United Kingdom',
  manualMode: false,
  packVersionId: 'pv1',
  targetDeadline: null,
  travelStartDate: null,
  assignments: [] as { memberAccountId: string; memberEmail: string }[],
  notes: [],
  tasks: [] as { status: string; dueDate: string }[],
  readiness: { ready: false, requiredCount: 5, satisfiedRequired: 3 } as unknown,
  liveAcknowledgementAt: null,
};
const needsAttention = {
  ...base,
  missionId: 'm1',
  applicantName: 'Rahim Uddin',
  targetDeadline: SOON,
  tasks: [{ status: 'OPEN', dueDate: PAST }],
};
const inGoodShape = {
  ...base,
  missionId: 'm2',
  applicantId: 'ap2',
  applicantName: 'Nusrat Jahan',
  title: 'Schengen Short Stay',
  state: 'IN_REVIEW',
  destination: 'France',
  assignments: [{ memberAccountId: 'acct-1', memberEmail: 'me@example.com' }],
  tasks: [{ status: 'OPEN', dueDate: LATER }],
  readiness: { ready: true, requiredCount: 4, satisfiedRequired: 4 },
};
const noChecklist = {
  ...inGoodShape,
  missionId: 'm3',
  packVersionId: null,
  readiness: null,
  assignments: [],
};
// More cases than a phone shows at first, so the show-all control is drawn.
const many = Array.from({ length: 7 }, (_, index) => ({
  ...inGoodShape,
  missionId: `x${index}`,
  applicantName: `Traveller ${index}`,
}));

function asAdmin(cases: unknown[] = [inGoodShape, needsAttention, noChecklist, ...many]) {
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([{ accountId: 'acct-1', email: 'me@example.com' }]);
  mocks.loadEvidenceRequests.mockResolvedValue([
    { id: 'r1', applicantId: 'ap1', status: 'OPEN' },
    { id: 'r2', applicantId: 'ap1', status: 'NEEDS_REPLACEMENT' },
    { id: 'r3', applicantId: 'ap2', status: 'ACCEPTED' },
  ]);
  mocks.loadApplicants.mockResolvedValue([{ id: 'ap1' }, { id: 'ap2' }]);
  mocks.loadCases.mockResolvedValue({ admin: true, cases });
  mocks.loadUnassignedQueue.mockResolvedValue([
    { missionId: 'm1', title: 'UK Standard Visitor', applicantName: 'Rahim Uddin' },
  ]);
  mocks.loadClientsJoined.mockResolvedValue({ total: 7, last30Days: 3 });
}

async function draw(
  locale: 'en' | 'bn',
  search: Record<string, string> = {},
): Promise<{ html: string; text: string }> {
  current.holder = null;
  current.locale = locale;
  const html = await renderServer(Page(pageProps(search)));
  return { html, text: textOf(html) };
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1';
  asAdmin();
});

const OVERVIEW = 'appAgencyOrgidPage';

describe('the agency overview under Bengali', () => {
  it('draws the counts, the case table and its headings in Bengali for an administrator', async () => {
    const { html } = await draw('bn');
    expect(
      missingBengali(html, [
        `${OVERVIEW}.agencyOverview`,
        `${OVERVIEW}.whatNeedsYouFirst`,
        `${OVERVIEW}.casesYouCanSee`,
        `${OVERVIEW}.casesWithNobodyAssigned`,
        `${OVERVIEW}.evidenceRequestsWaitingOnTheTraveller`,
        `${OVERVIEW}.overdueTasks`,
        `${OVERVIEW}.clientsJoined`,
        `${OVERVIEW}.joinedInTheLast30Days`,
        `${OVERVIEW}.casePipeline`,
        `${OVERVIEW}.case`,
        `${OVERVIEW}.readiness`,
        `${OVERVIEW}.deadline`,
        `${OVERVIEW}.traveller`,
        `${OVERVIEW}.casesMostUrgentFirst`,
        `${OVERVIEW}.assignedToYou`,
        `${OVERVIEW}.needsAssignment`,
        `${OVERVIEW}.ready`,
        `${OVERVIEW}.reassignmentQueue`,
        `${OVERVIEW}.viewAllCases`,
        `${OVERVIEW}.manageRequests`,
        `${OVERVIEW}.manageTeam`,
        `${OVERVIEW}.viewAccessibleCaseActivity`,
      ]),
    ).toEqual([]);
    expect(html).not.toMatch(/appAgency\./);
  });

  it('draws the phone column names in the same language as the headings', async () => {
    const { html } = await draw('bn');
    const labels = [...html.matchAll(/data-label="([^"]*)"/g)].map((match) => match[1]);
    // The marked headings hold a span now (a lang attribute on Bengali words), so read the text inside.
    const headings = [
      ...new JSDOM(`<body>${html}</body>`).window.document.querySelectorAll('th[scope="col"]'),
    ].map((cell) => cell.textContent);
    expect(labels.length).toBeGreaterThan(0);
    // Every phone label is the very heading of its column, so the two never differ in language.
    for (const label of labels) expect(headings).toContain(label);
    // Most columns are Bengali; Needs Attention waits on the register and stays English in both.
    expect(labels.filter((label) => /[ঀ-৿]/.test(label ?? '')).length).toBeGreaterThan(0);
  });

  it('keeps the show-all toggle in one language: English, since its words wait for sign-off', async () => {
    const { html } = await draw('bn');
    expect(html).toContain('aria-label="Show All 10 Cases"');
    expect(html).toContain('Show Fewer Cases');
    expect(html).toContain('Show the Other 5 Cases');
  });

  it('draws an unassigned or no-checklist case in Bengali', async () => {
    const { html } = await draw('bn');
    expect(missingBengali(html, [`${OVERVIEW}.noPackAttached`, `${OVERVIEW}.nothing`])).toEqual([]);
  });

  it('draws the empty states in Bengali (no cases, nothing waiting, no requests)', async () => {
    asAdmin([]);
    mocks.loadEvidenceRequests.mockResolvedValue([]);
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    mocks.loadClientsJoined.mockResolvedValue({ total: 0, last30Days: 0 });
    const { html } = await draw('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        `${OVERVIEW}.nothingIsOverdueUnassignedOrWaiting`,
        `${OVERVIEW}.noCaseStagesToShow`,
        `${OVERVIEW}.noEvidenceRequestsYet`,
        `${OVERVIEW}.setUpYourAgency`,
      ]),
    ).toEqual([]);
  });

  it('draws the member view in Bengali, with the list of cases assigned to them', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    mocks.loadMembers.mockResolvedValue([]);
    mocks.loadEvidenceRequests.mockResolvedValue([]);
    mocks.loadCases.mockResolvedValue({ admin: false, cases: [inGoodShape] });
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    const { html } = await draw('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        `${OVERVIEW}.assignedCases`,
        `${OVERVIEW}.openAssignedCases`,
        `${OVERVIEW}.yourCaseWork`,
      ]),
    ).toEqual([]);
  });

  it('draws the quick views and the search results in Bengali', async () => {
    const { html } = await draw('bn', { quick: 'overdue' });
    expect(html).not.toMatch(/appAgency\./);
    expect(missingBengali(html, [`${OVERVIEW}.quickViewsOfTheCaseList`])).toEqual([]);
  });
});

describe('the agency overview numbers in English', () => {
  it('shows a count of a thousand or more without a thousands separator, as it always did', async () => {
    mocks.loadClientsJoined.mockResolvedValue({ total: 1234, last30Days: 1500 });
    const { text } = await draw('en');
    expect(text).toMatch(/Clients Joined 1234/);
    expect(text).toMatch(/Joined in the Last 30 Days 1500/);
    expect(text).not.toContain('1,234');
    expect(text).not.toContain('1,500');
  });

  it('shows Bengali digits for the same counts under Bengali', async () => {
    mocks.loadClientsJoined.mockResolvedValue({ total: 1234, last30Days: 1500 });
    const { text } = await draw('bn');
    expect(text).toContain('১,২৩৪');
    expect(text).toContain('১,৫০০');
  });
});
