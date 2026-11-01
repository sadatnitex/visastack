import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agencyBrand } from '../agency-brand';
import { navigationState, renderServer } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';
import { levelContaining, levelForLink } from './reveal';

/** Agency Cases (screen 15): see parity-kit.test-support.ts for how the comparison works. */

const state = vi.hoisted(() => ({
  admin: true,
  cases: [] as unknown[],
  requests: [] as unknown[],
  members: [] as unknown[],
  depth: 'auto',
}));

vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../../app/app/agency/[orgId]/console-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/app/agency/[orgId]/console-data')>();
  return {
    AGENCY_LIST_SIZES: actual.AGENCY_LIST_SIZES,
    CASE_NOTES_STEP: actual.CASE_NOTES_STEP,
    loadOrgAccess: async () => ({
      org: { id: 'o1', name: 'Atlas Visa' },
      admin: state.admin,
      member: true,
    }),
    loadMembers: async () => state.members,
    loadEvidenceRequests: async () => state.requests,
    // WP-SB5: the list reads light rows; the one open case is read in full.
    loadCaseListPage: async () => ({
      admin: state.admin,
      total: state.cases.length,
      nextCursor: null,
      cases: state.cases,
    }),
    loadOpenCase: async (...args: unknown[]) => {
      const found = (state.cases as { missionId: string; notes: unknown[] }[]).find(
        (c) => c.missionId === args[4],
      );
      return found ? { ...found, notesTotal: found.notes.length, notesNextCursor: null } : null;
    },
  };
});
vi.mock('./depth.server', () => ({ readDepth: async () => state.depth }));

const { default: Page } = await import('../../app/app/agency/[orgId]/cases/page');
const { AgencyWorkspaceHeading } = await import('../../app/app/agency/[orgId]/workspace-heading');

const LATER = '2030-01-01T00:00:00.000Z';
// Case ids in the shape the page accepts in its address. The reference codes stay the ones the
// baseline was captured with (C-M17K2Q, C-M27K2Q).
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const CODES: Record<string, string> = { [M1]: 'C-M17K2Q', [M2]: 'C-M27K2Q' };

const kase = (id: string, over: Record<string, unknown> = {}) => ({
  missionId: id,
  applicantId: `ap-${id}`,
  applicantName: `Traveller ${id}`,
  title: `Case ${id}`,
  referenceCode: CODES[id] ?? `C-${id.toUpperCase()}7K2Q`,
  state: 'DRAFT',
  manualMode: false,
  readiness: { ready: false, requiredCount: 2, satisfiedRequired: 1 },
  assignments: [],
  notes: [],
  tasks: [],
  appointments: [],
  requirements: [],
  decisions: [],
  issuerVerifications: [],
  viewerAssigned: false,
  ...over,
});

const me = { accountId: 'acct-1', email: 'me@example.com', role: 'ADMIN', active: true };
const colleague = {
  accountId: 'acct-2',
  email: 'case@example.com',
  role: 'CASE_WORKER',
  active: true,
};

const busy = () => {
  state.members = [me, colleague];
  state.cases = [
    kase(M1, {
      assignments: [{ id: 'as1', memberAccountId: 'acct-1', memberEmail: 'me@example.com' }],
      viewerAssigned: true,
      notes: [
        {
          id: 'n1',
          body: 'Bank letter promised for Friday',
          authorEmail: 'me@example.com',
          createdAt: '2026-10-20T09:00:00.000Z',
          visibility: 'AGENCY_INTERNAL',
        },
      ],
      tasks: [
        {
          id: 't1',
          description: 'Bring the bank letter',
          status: 'OPEN',
          priority: 'HIGH',
          assigneeAccountId: 'acct-1',
          dueDate: LATER,
        },
        {
          id: 't2',
          description: 'Book the photo',
          status: 'IN_PROGRESS',
          priority: 'NORMAL',
          assigneeAccountId: 'acct-2',
          dueDate: null,
        },
      ],
      appointments: [
        {
          id: 'ap1',
          title: 'Interview prep call',
          localDateTime: '2030-01-02T10:00:00',
          timezone: 'Asia/Dhaka',
          place: null,
          channel: 'Video',
          status: 'OPEN',
        },
      ],
      requirements: [
        { id: 'q1', label: 'Passport Number' },
        { id: 'q2', label: 'Bank Statement' },
      ],
      decisions: [
        {
          id: 'd1',
          packRequirementId: 'q1',
          outcome: 'ACCEPTED',
          reason: null,
          createdAt: '2026-10-21T09:00:00.000Z',
        },
      ],
      issuerVerifications: [
        {
          id: 'iv1',
          packRequirementId: 'q2',
          issuerIdentity: 'City Bank',
          exactClaim: 'Account open since 2019',
          response: 'Confirmed by phone',
          validUntil: LATER,
          expired: false,
        },
      ],
    }),
    kase(M2, { requirements: [{ id: 'q3', label: 'Photo' }] }),
  ];
  state.requests = [
    {
      id: 'r1',
      applicantId: `ap-${M2}`,
      missionId: M2,
      packRequirementId: 'q3',
      kind: 'DOCUMENT',
      status: 'RECEIVED',
      docType: 'PHOTO',
      dueDate: null,
      createdAt: '2026-10-22T09:00:00.000Z',
    },
  ];
};

/**
 * WP-SB5: the Cases screen lists every case and opens one at a time (`?case=<id>`). Nothing may be
 * lost, so the screen is rendered as the list, then with each case opened in turn, and every
 * element the old screen showed at once must be found across those views.
 */
const render = async () => {
  const views = [
    {},
    ...(state.cases as { missionId: string }[]).map((c) => ({ case: c.missionId })),
  ];
  const pages = await Promise.all(
    views.map((query) =>
      Page({ params: Promise.resolve({ orgId: 'o1' }), searchParams: Promise.resolve(query) }),
    ),
  );
  return await renderServer(
    Promise.resolve(
      <>
        <AgencyWorkspaceHeading
          organizationId="o1"
          brand={agencyBrand({ name: 'Atlas Visa', accentColor: null, logoUrl: null })}
          admin={state.admin}
          status={null}
        />
        {pages}
      </>,
    ),
  );
};

registerParity({
  name: 'agency-cases',
  reset: () => {
    navigationState.pathname = '/app/agency/o1/cases';
    state.admin = true;
    state.cases = [];
    state.requests = [];
    state.members = [me];
    state.depth = 'auto';
  },
  render,
  states: [
    { name: 'an administrator with no cases', setup: () => undefined },
    {
      name: 'a member with no cases',
      setup: () => {
        state.admin = false;
      },
    },
    { name: 'a busy administrator', setup: busy },
    {
      name: 'a member',
      setup: () => {
        busy();
        state.admin = false;
        state.requests = [];
      },
    },
  ],
});

describe('agency cases levels', () => {
  const page = async () => new JSDOM(await render()).window.document;
  const levelOf = (el: Element | null | undefined) =>
    el ? levelContaining(el as HTMLElement, el.ownerDocument.body) : 'none';
  beforeEach(() => {
    navigationState.pathname = '/app/agency/o1/cases';
    state.admin = true;
    state.depth = 'auto';
    busy();
  });

  it('shows every case row at Glance, with what needs this person', async () => {
    const doc = await page();
    const rows = [...doc.querySelectorAll('[id^="mission-"]')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(levelOf(row)).toBe('glance');
      expect(levelOf(row.querySelector('.case-work-title'))).toBe('glance');
    }
    const needs = rows.map((row) => row.querySelector('[data-only="glance"]')?.textContent);
    expect(needs[0]).toBe('Needs you: 1 task.');
    expect(needs[1]).toBe('Needs you: 1 item to review and someone to look after it.');
  });

  it('keeps where things stand and who is assigned at Browse', async () => {
    const doc = await page();
    const row = doc.querySelector(`#mission-${M1}`);
    expect(levelOf(row?.querySelector(`#triage-${M1}`))).toBe('browse');
    expect(levelOf(row?.querySelector('[aria-label="Member to assign"]'))).toBe('browse');
  });

  it('keeps the working sections at Everything, and opens them for a link to the case', async () => {
    const doc = await page();
    const row = doc.querySelector(`#mission-${M1}`);
    for (const label of [
      'Task description',
      'Appointment title',
      'Case note',
      'Decision',
      'Issuer identity',
    ]) {
      expect(levelOf(row?.querySelector(`[aria-label="${label}"]`)), label).toBe('everything');
    }
    expect(levelOf(row)).toBe('glance');
    expect(levelForLink(row as HTMLElement, doc.body)).toBe('everything');
  });

  it('ends the notes with their count right under them, before the note form (WP-SB5)', async () => {
    const notes = (await page()).querySelector(`#notes-${M1}`);
    const count = notes?.querySelector('.show-more-count');
    expect(count?.textContent).toBe('Showing the only note.');
    const form = notes?.querySelector('form');
    expect(form).not.toBeNull();
    expect(
      count && form ? count.compareDocumentPosition(form) & count.DOCUMENT_POSITION_FOLLOWING : 0,
    ).toBeTruthy();
  });

  it('names the confirmations without a reference code', async () => {
    const text = (await page()).body.textContent ?? '';
    expect(text).toContain('Issuer Confirmations');
    expect(text).not.toContain('EVI-05');
  });

  it("never builds a member's line from requests, which are administrator data", async () => {
    state.admin = false; // busy() left the request on m2 in place
    // Assigned, so a request reaching this member's summary would be counted.
    state.cases = state.cases.map((c) =>
      (c as { missionId: string }).missionId === M2
        ? { ...(c as object), viewerAssigned: true }
        : c,
    );
    const doc = await page();
    expect(doc.querySelector(`#mission-${M2} [data-only="glance"]`)?.textContent).toBe(
      'Nothing needs you on this case right now.',
    );
  });
});
