import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agencyBrand } from '../agency-brand';
import { navigationState, renderServer } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';
import { levelContaining } from './reveal';

/** Agency Overview (screen 14): see parity-kit.test-support.ts for how the comparison works. */

const state = vi.hoisted(() => ({
  admin: true,
  cases: [] as unknown[],
  requests: [] as unknown[],
  queue: [] as unknown[],
  joined: null as unknown,
  members: [] as unknown[],
  applicants: [] as unknown[],
  search: {} as Record<string, string>,
  depth: 'auto',
}));

vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../../app/app/agency/[orgId]/console-data', () => ({
  loadOrgAccess: async () => ({
    org: { id: 'o1', name: 'Atlas Visa' },
    admin: state.admin,
    member: true,
  }),
  loadMembers: async () => state.members,
  loadEvidenceRequests: async () => state.requests,
  loadCases: async () => ({ admin: state.admin, cases: state.cases }),
  loadApplicants: async () => state.applicants,
  loadUnassignedQueue: async () => state.queue,
  loadClientsJoined: async () => state.joined,
}));
vi.mock('./depth.server', () => ({ readDepth: async () => state.depth }));

const { default: Page } = await import('../../app/app/agency/[orgId]/page');
const { AgencyWorkspaceHeading } = await import('../../app/app/agency/[orgId]/workspace-heading');

const PAST = '2026-10-20T00:00:00.000Z';
const LATER = '2030-01-01T00:00:00.000Z';

const kase = (id: string, over: Record<string, unknown> = {}) => ({
  missionId: id,
  applicantId: `ap-${id}`,
  applicantName: `Traveller ${id}`,
  title: `Case ${id}`,
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
  ...over,
});

const me = { accountId: 'acct-1', email: 'me@example.com', role: 'ADMIN', active: true };
const busy = () => {
  state.members = [
    me,
    { accountId: 'acct-2', email: 'case@example.com', role: 'CASE_WORKER', active: true },
    { accountId: 'acct-3', email: 'gone@example.com', role: 'CASE_WORKER', active: false },
  ];
  state.cases = [
    ...Array.from({ length: 9 }, (_, i) => kase(`m${i}`)),
    kase('m9', {
      state: 'IN_REVIEW',
      destination: 'France',
      assignments: [{ memberAccountId: 'acct-1', memberEmail: 'me@example.com' }],
      tasks: [{ status: 'OPEN', dueDate: LATER }],
      readiness: { ready: true, requiredCount: 4, satisfiedRequired: 4 },
    }),
  ];
  state.applicants = state.cases.map((c) => ({ id: (c as { applicantId: string }).applicantId }));
  state.requests = [
    {
      id: 'r1',
      applicantId: 'ap-m0',
      applicantName: 'Traveller m0',
      status: 'OPEN',
      docType: 'BANK_STATEMENT',
      dueDate: LATER,
      referenceCode: 'R-7K2Q9M',
    },
    { id: 'r2', applicantId: 'ap-m1', status: 'RECEIVED', fieldKey: 'passport_number' },
  ];
  state.queue = [{ missionId: 'm0', title: 'Case m0', applicantName: 'Traveller m0' }];
  state.joined = { total: 7, last30Days: 3 };
};

registerParity({
  name: 'agency-home',
  reset: () => {
    navigationState.pathname = '/app/agency/o1';
    state.admin = true;
    state.cases = [];
    state.requests = [];
    state.queue = [];
    state.joined = null;
    state.members = [me];
    state.applicants = [];
    state.search = {};
    state.depth = 'auto';
  },
  // The layout's heading holds the page's one h1, so it is part of the screen.
  render: async () =>
    await renderServer(
      Page({
        params: Promise.resolve({ orgId: 'o1' }),
        searchParams: Promise.resolve(state.search),
      }).then((page) => (
        <>
          <AgencyWorkspaceHeading
            organizationId="o1"
            brand={agencyBrand({ name: 'Atlas Visa', accentColor: null, logoUrl: null })}
            admin={state.admin}
            status={null}
          />
          {page}
        </>
      )),
    ),
  states: [
    { name: 'a new agency with nothing yet', setup: () => undefined },
    { name: 'a busy administrator', setup: busy },
    {
      name: 'a member',
      setup: () => {
        busy();
        state.admin = false;
        state.joined = null;
        state.queue = [];
      },
    },
    {
      name: 'a quick view',
      setup: () => {
        busy();
        state.search = { quick: 'unassigned' };
      },
    },
    {
      name: 'a search with no match',
      setup: () => {
        busy();
        state.search = { q: 'nothing like this' };
      },
    },
  ],
});

describe('agency overview levels', () => {
  const page = async () =>
    new JSDOM(
      await renderServer(
        Page({
          params: Promise.resolve({ orgId: 'o1' }),
          searchParams: Promise.resolve(state.search),
        }),
      ),
    ).window.document;
  const levelOf = (el: Element | null | undefined) =>
    el ? levelContaining(el as HTMLElement, el.ownerDocument.body) : 'none';
  const byHeading = (doc: Document, name: string) =>
    [...doc.querySelectorAll('h2')].find((h) => h.textContent?.trim() === name);
  beforeEach(() => {
    navigationState.pathname = '/app/agency/o1';
    state.admin = true;
    state.search = {};
    state.depth = 'auto';
    busy();
  });

  it('shows the numbers and the first thing to do at Glance, the working lists at Browse', async () => {
    const doc = await page();
    expect(levelOf(doc.querySelector('.agency-reference-metrics'))).toBe('glance');
    const items = [...doc.querySelectorAll('.do-next-item')];
    expect(items.length).toBeGreaterThan(1);
    expect(levelOf(items[0])).toBe('glance');
    for (const item of items.slice(1)) expect(levelOf(item)).toBe('browse');
    expect(doc.querySelector('.do-next [data-only="glance"]')?.textContent).toMatch(
      /\d+ more need you\. Choose Browse to see them\./,
    );
    expect(levelOf(byHeading(doc, 'Case Pipeline'))).toBe('browse');
    expect(levelOf(byHeading(doc, 'Cases and Attention'))).toBe('browse');
    expect(levelOf(byHeading(doc, 'Evidence Requests'))).toBe('browse');
    expect(levelOf(byHeading(doc, 'Your Team'))).toBe('browse');
  });

  it('keeps search, the queue, activity, setup and attention details at Everything', async () => {
    const doc = await page();
    expect(levelOf(doc.querySelector('.agency-working-area form'))).toBe('everything');
    expect(levelOf(byHeading(doc, 'Reassignment Queue'))).toBe('everything');
    expect(levelOf(byHeading(doc, 'Case Activity'))).toBe('everything');
    expect(levelOf(doc.querySelector('.agency-clients-joined'))).toBe('everything');
    expect(levelOf(doc.querySelector('.agency-attention-disclosure'))).toBe('everything');
  });

  it('shows a list the person asked for (a search or a quick view) at Glance', async () => {
    state.search = { quick: 'unassigned' };
    const doc = await page();
    expect(levelOf(byHeading(doc, 'Cases and Attention'))).toBe('glance');
    expect(levelOf(doc.querySelector('.agency-working-area form'))).toBe('glance');
  });

  it("tells a member why some tools are not there, at Browse beside the member's own work", async () => {
    state.admin = false;
    const doc = await page();
    const notice = [...doc.querySelectorAll('p.card-body')].find((p) =>
      p.textContent?.includes('not an administrator'),
    );
    expect(levelOf(notice)).toBe('browse');
    expect(levelOf(byHeading(doc, 'Your Case Work'))).toBe('browse');
  });
});
