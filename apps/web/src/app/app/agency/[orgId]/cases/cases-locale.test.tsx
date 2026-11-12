import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const state = vi.hoisted(() => ({ admin: true, cases: [] as unknown[], open: null as unknown }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../console-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../console-data')>();
  return {
    AGENCY_LIST_SIZES: actual.AGENCY_LIST_SIZES,
    CASE_NOTES_STEP: actual.CASE_NOTES_STEP,
    loadOrgAccess: async () => ({ org: { id: 'o1' }, admin: state.admin, member: true }),
    loadMembers: async () => [],
    loadEvidenceRequests: async () => [],
    loadCaseListPage: async () => ({
      admin: state.admin,
      total: state.cases.length,
      nextCursor: null,
      cases: state.cases,
    }),
    loadOpenCase: async () => state.open,
  };
});
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listAccessEndsForOrg: async () => new Map<string, Date | null>(),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../mission-collaboration', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { MissionCollaboration: stub('MissionCollaboration') };
});
vi.mock('../request-evidence-form', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { RequestEvidenceForm: stub('RequestEvidenceForm') };
});

import { appAgencyCatalog } from '../../../../../i18n/app-agency';

const { default: Page } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const bn = appAgencyCatalog.bn as Record<string, string>;
const k = (key: string) => `appAgency.appAgencyOrgidCasesPage.${key}`;
const M1 = '11111111-1111-4111-8111-111111111111';

const row = (over: Record<string, unknown> = {}) => ({
  missionId: M1,
  applicantName: 'Rahim',
  title: 'UK Visitor',
  state: 'DRAFT',
  referenceCode: 'C-M17K2Q',
  targetDeadline: '2026-12-03T00:00:00.000Z',
  ...over,
});

async function show(locale: 'en' | 'bn', query: Record<string, string> = {}) {
  current.holder = null;
  current.locale = locale;
  return textOf(
    await renderServer(
      Page({ params: Promise.resolve({ orgId: 'o1' }), searchParams: Promise.resolve(query) }),
    ),
  );
}

beforeEach(() => {
  state.admin = true;
  state.cases = [];
  state.open = null;
  navigationState.pathname = '/app/agency/o1/cases';
});
afterEach(() => {
  current.locale = 'en';
});

describe('the agency Cases page under Bengali', () => {
  it('shows the Bengali heading, list words and Bengali-digit deadline when there are cases (list state)', async () => {
    state.cases = [row()];
    const text = await show('bn');
    expect(text).toContain(bn[k('cases')]);
    expect(text).toContain(bn[k('aboutCases')]);
    expect(text).toContain(bn[k('chooseACaseToOpenIts')]);
    expect(text).toContain(bn[k('openCase')]);
    // The deadline sits inside a Bengali sentence, so its date is Bengali too.
    expect(text).toContain('· শেষ তারিখ ৩ ডিসে, ২০২৬');
    expect(text).not.toContain('Dec 3, 2026');
    // The administrator sentence waits for sign-off (access): English.
    expect(text).toContain('Assign a team member and leave case notes');
    expect(text).not.toMatch(/appAgency\./);
  });

  it('keeps the list in English for English readers', async () => {
    state.cases = [row()];
    const text = await show('en');
    expect(text).toContain('Open Case');
    expect(text).toContain('· deadline Dec 3, 2026');
    expect(text).not.toMatch(BENGALI);
  });

  it('shows the Bengali empty state title and keeps the access explanation in English (administrator)', async () => {
    const text = await show('bn');
    expect(text).toContain(bn[k('noCasesYet')]);
    expect(text).toContain('No cases are reachable yet');
    // These two still sit in props that the catalogue does not hold; they stay English.
    expect(text).toContain('Invite a Client');
  });

  it('shows the Bengali empty state title and keeps the assignment sentence in English (member)', async () => {
    state.admin = false;
    const text = await show('bn');
    expect(text).toContain(bn[k('noCasesYet')]);
    expect(text).toContain("You aren't assigned to any cases yet.");
    expect(text).toContain("Leave case notes and record decisions on cases you're assigned to.");
  });

  it('keeps the closed-case message in English (it is about access)', async () => {
    state.cases = [row()];
    const text = await show('bn', { case: M1 });
    expect(text).toContain('That case is not open to you.');
  });

  it('labels the open case workspace in Bengali, and marks the open row in English', async () => {
    state.cases = [row()];
    state.open = {
      ...row(),
      applicantId: 'ap1',
      manualMode: false,
      readiness: { ready: false, requiredCount: 2, satisfiedRequired: 1 },
      assignments: [],
      notes: [],
      notesTotal: 0,
      notesNextCursor: null,
      tasks: [],
      appointments: [],
      requirements: [],
      decisions: [],
      issuerVerifications: [],
      viewerAssigned: false,
    };
    current.holder = null;
    current.locale = 'bn';
    const html = await renderServer(
      Page({
        params: Promise.resolve({ orgId: 'o1' }),
        searchParams: Promise.resolve({ case: M1 }),
      }),
    );
    expect(html).toContain(`aria-label="${bn[k('openCasedd4d13')]}"`);
    expect(textOf(html)).toContain('Open Now');
  });
});
