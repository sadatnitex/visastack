import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flagEmoji } from '../../../../../components/country-flag';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  loadOrgAccess: vi.fn(),
  loadMembers: vi.fn(),
  // WP-SB5: the list reads no case detail; only the open case is read in full.
  loadCaseListPage: vi.fn(),
  loadOpenCase: vi.fn(async (..._args: unknown[]) => null as unknown),
  // Never called by this page any more: the Dashboard alone reads every case in full.
  loadCases: vi.fn(),
  // WP-V4: the page also reads requests (administrator data) for the open case's triage summary.
  loadEvidenceRequests: vi.fn(async () => [] as unknown[]),
  // P9: when access to each listed case ends; asked for the listed case ids only.
  listAccessEndsForOrg: vi.fn(async (..._args: unknown[]) => new Map<string, Date | null>()),
}));
vi.mock('@visastack/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@visastack/services')>();
  return { ...actual, listAccessEndsForOrg: mocks.listAccessEndsForOrg };
});

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../console-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../console-data')>();
  return {
    ...mocks,
    AGENCY_LIST_SIZES: actual.AGENCY_LIST_SIZES,
    CASE_NOTES_STEP: actual.CASE_NOTES_STEP,
  };
});
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../mission-collaboration', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  const Workspace = stub('MissionCollaboration');
  // The workspace places `notesMore` right under its notes; the stub shows it next to its props.
  return {
    MissionCollaboration: ({
      notesMore,
      ask,
      destinationLabel,
      ...rest
    }: { notesMore?: ReactNode; ask?: ReactNode; destinationLabel?: ReactNode }) => (
      <>
        <Workspace {...rest} hasAsk={ask !== undefined} />
        <div data-destination-label="">{destinationLabel}</div>
        <div data-notes-more="">{notesMore}</div>
        <div data-ask="">{ask}</div>
      </>
    ),
  };
});
vi.mock('../request-evidence-form', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { RequestEvidenceForm: stub('RequestEvidenceForm') };
});

const { default: Page } = await import('./page');

const props = { params: Promise.resolve({ orgId: 'o1' }) };
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const M3 = '33333333-3333-4333-8333-333333333333';
const opening = (query: Record<string, string>) => ({
  params: Promise.resolve({ orgId: 'o1' }),
  searchParams: Promise.resolve(query),
});
/** The list page the loader returns: light rows only. */
const listOf = (
  admin: boolean,
  rows: readonly { missionId: string; applicantName: string }[],
  more: { nextCursor?: string; total?: number } = {},
) => ({
  admin,
  total: more.total ?? rows.length,
  nextCursor: more.nextCursor ?? null,
  cases: rows.map((r) => ({
    missionId: r.missionId,
    applicantId: `ap-${r.missionId}`,
    applicantName: r.applicantName,
    title: `Case ${r.missionId}`,
    state: 'INTAKE',
    destination: 'United Kingdom',
    targetDeadline: null,
  })),
});
/** The open case the loader returns. */
const openOf = (c: ReturnType<typeof aCase>, extra: Record<string, unknown> = {}) => ({
  ...c,
  notesTotal: c.notes.length,
  notesNextCursor: null,
  ...extra,
});

const aCase = (id: string, applicantName: string) => ({
  missionId: id,
  applicantId: `ap-${id}`,
  applicantName,
  title: `Case ${id}`,
  assignments: [{ memberAccountId: 'acct-1', memberEmail: 'me@example.com' }],
  notes: [{ id: 'n1' }],
  tasks: [
    {
      id: 't1',
      description: 'Bring the bank letter',
      status: 'OPEN',
      priority: 'NORMAL',
      assigneeAccountId: null,
      dueDate: null,
      dueTimezone: 'Asia/Dhaka',
    },
  ],
  appointments: [],
  requirements: [{ id: 'q1', label: 'Passport Number' }],
  decisions: [],
  issuerVerifications: [],
  viewerAssigned: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/cases';
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([
    { accountId: 'acct-1', email: 'me@example.com', role: 'OWNER', active: true },
  ]);
  mocks.loadCaseListPage.mockResolvedValue(
    listOf(true, [
      { missionId: M1, applicantName: 'Rahim Uddin' },
      { missionId: M2, applicantName: 'Nusrat Jahan' },
    ]),
  );
  mocks.loadOpenCase.mockImplementation(async (...args: unknown[]) =>
    args[4] === M1 ? openOf(aCase(M1, 'Rahim Uddin')) : null,
  );
});

describe('agency Cases', () => {
  it('lists every visible case with a link that opens it, and reads no case in full until one is open', async () => {
    const html = await renderServer(Page(props));
    const text = textOf(html);
    expect(text).toContain(`Rahim Uddin · Case ${M1}`);
    expect(text).toContain(`Nusrat Jahan · Case ${M2}`);
    expect(html).toContain(`href="/app/agency/o1/cases?case=${M1}#mission-${M1}"`);
    expect(html).toContain(`href="/app/agency/o1/cases?case=${M2}#mission-${M2}"`);
    // VS-023: the anchor is real text, never a client reference printed into the address.
    expect(html).not.toContain('[object');
    expect(html).not.toContain('undefined');
    expect(stubProps(html, 'MissionCollaboration')).toEqual([]);
    expect(mocks.loadOpenCase).not.toHaveBeenCalled();
    expect(mocks.loadCases).not.toHaveBeenCalled();
    expect(mocks.loadEvidenceRequests).not.toHaveBeenCalled();
    expect(text).toContain('Choose a case to open its workspace');
  });

  it('says when access to a listed case ends, and that only the traveller can extend it, with no button', async () => {
    mocks.listAccessEndsForOrg.mockResolvedValue(
      new Map<string, Date | null>([
        [M1, new Date('2026-12-05T10:00:00Z')],
        [M2, null],
      ]),
    );
    const html = await renderServer(Page(props));
    const text = textOf(html);
    // Only the cases this member can already see on the page are asked about.
    expect(mocks.listAccessEndsForOrg).toHaveBeenCalledWith({}, 'o1', [M1, M2]);
    expect(text).toContain('Access ends on 5 Dec 2026. The traveller can extend it.');
    // One line only: a case with no end date shows none, and nothing here extends anything.
    expect(html.match(/data-testid="access-ends-note"/g)).toHaveLength(1);
    expect(text).not.toContain('Keep Sharing');
  });

  it('draws the flag beside the written country of each listed case, and none for a case with no country (P16)', async () => {
    const list = listOf(true, [
      { missionId: M1, applicantName: 'Rahim Uddin' },
      { missionId: M2, applicantName: 'Nusrat Jahan' },
      { missionId: M3, applicantName: 'Salma Akter' },
    ]);
    mocks.loadCaseListPage.mockResolvedValue({
      ...list,
      cases: list.cases.map((c) =>
        c.missionId === M2
          ? { ...c, destination: 'Not sure yet' }
          : c.missionId === M3
            ? { ...c, destination: '   ' }
            : c,
      ),
    });
    const html = await renderServer(Page(props));
    const rowOf = (id: string) =>
      html.split(`href="/app/agency/o1/cases?case=${id}#mission-${id}"`)[1]?.split('</a>')[0] ?? '';
    expect(rowOf(M1)).toContain(
      `<span class="country-flag-inline"><span class="country-flag" data-size="sm" data-flag-kind="emoji" aria-hidden="true">${flagEmoji('GB')}</span>United Kingdom</span>`,
    );
    // The same line still carries the stage, and the heading text is untouched.
    expect(textOf(rowOf(M1))).toContain(`Rahim Uddin · Case ${M1}`);
    expect(textOf(rowOf(M1))).toContain('United Kingdom');
    expect(rowOf(M2)).toContain('Not sure yet');
    expect(rowOf(M2)).not.toContain('country-flag');
    expect(rowOf(M3)).not.toContain('country-flag');
    // A blank destination leaves no dangling separator after the stage.
    const metaOf = (id: string) =>
      rowOf(id).split('agency-case-list-meta muted">')[1]?.split('</span>')[0];
    expect(metaOf(M3)).toBe('Intake');
    expect(html.match(/class="country-flag"/g)).toHaveLength(1);
    expect(html).not.toContain('country-flag-unknown');
  });

  it("keeps P9's Access Ends line under a case that also shows a flag (P16)", async () => {
    mocks.listAccessEndsForOrg.mockResolvedValue(
      new Map<string, Date | null>([[M1, new Date('2026-12-05T10:00:00Z')]]),
    );
    const html = await renderServer(Page(props));
    expect(textOf(html)).toContain('Access ends on 5 Dec 2026. The traveller can extend it.');
    expect(html.match(/data-testid="access-ends-note"/g)).toHaveLength(1);
    expect(html).toContain('class="country-flag"');
  });

  it('gives the open case workspace the flag and written country of its destination, and nothing for none (P16)', async () => {
    mocks.loadOpenCase.mockImplementation(async (...args: unknown[]) =>
      args[4] === M1 ? openOf(aCase(M1, 'Rahim Uddin'), { destination: 'United Kingdom' }) : null,
    );
    const withFlag = await renderServer(Page(opening({ case: M1 })));
    const slot = withFlag.split('data-destination-label=""')[1]?.split('</div>')[0] ?? '';
    expect(slot).toContain('data-flag-kind="emoji" aria-hidden="true"');
    expect(slot).toContain('data-size="md"');
    expect(textOf(slot)).toContain('United Kingdom');
    // The heading text the workspace gets is still the case's own title.
    expect(stubProps(withFlag, 'MissionCollaboration')[0]).toMatchObject({ title: `Case ${M1}` });

    mocks.loadOpenCase.mockImplementation(async (...args: unknown[]) =>
      args[4] === M1 ? openOf(aCase(M1, 'Rahim Uddin'), { destination: null }) : null,
    );
    const without = await renderServer(Page(opening({ case: M1 })));
    const emptySlot = without.split('data-destination-label=""')[1]?.split('</div>')[0] ?? '';
    expect(emptySlot).not.toContain('country-flag');
  });

  it('asks about no cases when the list is empty', async () => {
    mocks.loadCaseListPage.mockResolvedValue(listOf(true, []));
    await renderServer(Page(props));
    expect(mocks.listAccessEndsForOrg).toHaveBeenCalledWith({}, 'o1', []);
  });

  it('opens one case in its workspace, with the people who can be assigned', async () => {
    const html = await renderServer(Page(opening({ case: M1 })));
    const workspaces = stubProps<{
      missionId: string;
      organizationId: string;
      members: unknown;
      viewerAssigned: boolean;
      applicantName: string;
    }>(html, 'MissionCollaboration');
    expect(workspaces.map((w) => w.missionId)).toEqual([M1]);
    expect(workspaces[0]?.organizationId).toBe('o1');
    expect(workspaces[0]?.members).toEqual([{ accountId: 'acct-1', email: 'me@example.com' }]);
    expect(workspaces[0]?.viewerAssigned).toBe(true);
    expect(workspaces[0]?.applicantName).toBe('Rahim Uddin');
    expect(html).toMatch(/aria-current="true"/);
  });

  it('lets an administrator ask for a document or detail from the open case, with its traveller and case chosen', async () => {
    const html = await renderServer(Page(opening({ case: M1 })));
    const forms = stubProps<{
      organizationId: string;
      applicants?: unknown[];
      fixed: { applicantId: string; applicantName: string; missionId: string; caseTitle: string };
    }>(html, 'RequestEvidenceForm');
    expect(forms).toHaveLength(1);
    expect(forms[0]?.organizationId).toBe('o1');
    // The traveller and case are the case's own: no lists to choose from are sent.
    expect(forms[0]?.applicants).toBeUndefined();
    expect(forms[0]?.fixed).toEqual({
      applicantId: `ap-${M1}`,
      applicantName: 'Rahim Uddin',
      missionId: M1,
      caseTitle: `Case ${M1}`,
    });
    expect(textOf(html)).toContain('Ask for a Document or Detail');
  });

  it('hands the form the open case own checklist gaps, with the request already waiting marked', async () => {
    mocks.loadOpenCase.mockResolvedValue(
      openOf({
        ...aCase(M1, 'Rahim Uddin'),
        manualMode: false,
        readiness: {
          missing: [
            { kind: 'DOCUMENT', key: 'NID', optional: false, reason: 'not_provided' },
            { kind: 'DOCUMENT', key: 'BANK_STATEMENT', optional: false, reason: 'not_provided' },
          ],
        },
      } as never),
    );
    mocks.loadEvidenceRequests.mockResolvedValue([
      { id: 'r1', kind: 'DOCUMENT', status: 'OPEN', fieldKey: null, docType: 'BANK_STATEMENT' },
    ]);
    const html = await renderServer(Page(opening({ case: M1 })));
    const forms = stubProps<{
      missing: { rows: { id: string; state: string }[] } | null;
      picker: { groups: unknown[] };
    }>(html, 'RequestEvidenceForm');
    expect(forms[0]?.picker.groups.length).toBeGreaterThan(10);
    expect(forms[0]?.missing?.rows.map((r) => [r.id, r.state])).toEqual([
      ['DOCUMENT:NID', 'ask'],
      ['DOCUMENT:BANK_STATEMENT', 'asked'],
    ]);
  });

  it('marks an item Already Asked, unticked, when it was asked from Clients with no case', async () => {
    mocks.loadOpenCase.mockResolvedValue(
      openOf({
        ...aCase(M1, 'Rahim Uddin'),
        manualMode: false,
        readiness: {
          missing: [
            { kind: 'DOCUMENT', key: 'NID', optional: false, reason: 'not_provided' },
            { kind: 'DOCUMENT', key: 'BANK_STATEMENT', optional: false, reason: 'not_provided' },
          ],
        },
      } as never),
    );
    // The case has no request of its own; the traveller has one with no case, for the NID.
    mocks.loadEvidenceRequests.mockResolvedValue([
      {
        id: 'r9',
        missionId: null,
        kind: 'DOCUMENT',
        status: 'OPEN',
        fieldKey: null,
        docType: 'NID',
      },
    ]);
    const html = await renderServer(Page(opening({ case: M1 })));
    const forms = stubProps<{ missing: { rows: { id: string; state: string }[] } | null }>(
      html,
      'RequestEvidenceForm',
    );
    expect(forms[0]?.missing?.rows.map((r) => [r.id, r.state])).toEqual([
      ['DOCUMENT:NID', 'asked'],
      ['DOCUMENT:BANK_STATEMENT', 'ask'],
    ]);
    // One read, through the same administrator check, for this case and this traveller only.
    expect(mocks.loadEvidenceRequests).toHaveBeenCalledTimes(1);
    expect(mocks.loadEvidenceRequests).toHaveBeenCalledWith(
      {},
      'acct-1',
      'o1',
      { org: { id: 'o1' }, admin: true, member: true },
      {
        withFileStates: true,
        forCase: { missionId: M1, applicantId: `ap-${M1}`, alsoWaitingWithoutCase: true },
      },
    );
  });

  it('gives a member who is not an administrator no way to ask, exactly as Clients does', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    const html = await renderServer(Page(opening({ case: M1 })));
    expect(stubProps(html, 'RequestEvidenceForm')).toHaveLength(0);
    expect(stubProps<{ hasAsk: boolean }>(html, 'MissionCollaboration')[0]?.hasAsk).toBe(false);
    expect(textOf(html)).not.toContain('Ask for a Document or Detail');
  });

  it('reads data for the one open case only, with the roster it just read and 10 notes', async () => {
    await renderServer(Page(opening({ case: M1 })));
    expect(mocks.loadOpenCase).toHaveBeenCalledTimes(1);
    expect(mocks.loadOpenCase).toHaveBeenCalledWith(
      {},
      'acct-1',
      'o1',
      [{ accountId: 'acct-1', email: 'me@example.com', role: 'OWNER', active: true }],
      M1,
      { notesLimit: 10, notesBefore: undefined },
    );
    expect(mocks.loadCaseListPage).toHaveBeenCalledWith({}, 'acct-1', 'o1', {
      limit: 15,
      before: undefined,
    });
    expect(mocks.loadCases).not.toHaveBeenCalled();
    expect(mocks.loadEvidenceRequests).toHaveBeenCalledWith(
      {},
      'acct-1',
      'o1',
      { org: { id: 'o1' }, admin: true, member: true },
      {
        withFileStates: true,
        forCase: { missionId: M1, applicantId: `ap-${M1}`, alsoWaitingWithoutCase: true },
      },
    );
  });

  it('opens nothing and reads nothing for an address that is not a case id', async () => {
    const html = await renderServer(Page(opening({ case: "m1' or 1=1" })));
    expect(mocks.loadOpenCase).not.toHaveBeenCalled();
    expect(stubProps(html, 'MissionCollaboration')).toEqual([]);
  });

  it('says so, and shows no workspace, for a case this person may not see', async () => {
    const html = await renderServer(Page(opening({ case: M2 })));
    expect(mocks.loadOpenCase).toHaveBeenCalledTimes(1);
    expect(stubProps(html, 'MissionCollaboration')).toEqual([]);
    expect(textOf(html)).toContain('That case is not open to you.');
  });

  it("never sends a task's own time zone to the browser", async () => {
    const html = await renderServer(Page(opening({ case: M1 })));
    const workspaces = stubProps<{ tasks: readonly Record<string, unknown>[] }>(
      html,
      'MissionCollaboration',
    );
    expect(workspaces[0]?.tasks).toEqual([
      {
        id: 't1',
        description: 'Bring the bank letter',
        status: 'OPEN',
        priority: 'NORMAL',
        assigneeAccountId: null,
        dueDate: null,
      },
    ]);
    expect(html).not.toContain('Asia/Dhaka');
  });

  it('describes the section for an administrator and for a member', async () => {
    expect(textOf(await renderServer(Page(props)))).toContain(
      'Assign a team member and leave case notes on any case this organization has a grant for.',
    );
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    mocks.loadCaseListPage.mockResolvedValue(
      listOf(false, [{ missionId: M1, applicantName: 'Rahim Uddin' }]),
    );
    expect(textOf(await renderServer(Page(props)))).toContain(
      "Leave case notes and record decisions on cases you're assigned to.",
    );
  });

  it('explains an empty list differently for an administrator and a member', async () => {
    mocks.loadCaseListPage.mockResolvedValue(listOf(true, []));
    expect(textOf(await renderServer(Page(props)))).toContain('No cases are reachable yet');
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    mocks.loadCaseListPage.mockResolvedValue(listOf(false, []));
    const memberText = textOf(await renderServer(Page(props)));
    expect(memberText).toContain("You aren't assigned to any cases yet");
    // Team is for owners and admins only, so the member is told who can help, not sent there.
    expect(memberText).toContain('An owner or admin of this organization can assign you');
    expect(memberText).not.toContain('/team');
  });

  it('renders nothing, and reads no case, for someone with no role', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: false });
    expect(await renderServer(Page(opening({ case: M1 })))).toBe('');
    expect(mocks.loadCaseListPage).not.toHaveBeenCalled();
    expect(mocks.loadOpenCase).not.toHaveBeenCalled();
    expect(mocks.loadMembers).not.toHaveBeenCalled();
  });
});

describe('agency Cases: within the scroll budget (WP-SB5)', () => {
  it('shows 15 cases of 200 with Show More that grows by 15, keeping the open case', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      missionId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      applicantName: `Traveller ${i}`,
    }));
    mocks.loadCaseListPage.mockResolvedValue(
      listOf(true, rows, { nextCursor: 'list-next', total: 200 }),
    );
    const html = await renderServer(Page(opening({ case: M1 })));
    expect(html.match(/class="agency-case-list-row"/g)).toHaveLength(15);
    expect(textOf(html)).toContain('Showing 15 of 200 cases.');
    expect(html).toContain(`href="/app/agency/o1/cases?case=${M1}&amp;show=30#agency-case-list"`);
  });

  it('past 90 cases continues with older pages of 90, saying exactly which cases show', async () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({
      missionId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      applicantName: `Traveller ${i}`,
    }));
    mocks.loadCaseListPage.mockResolvedValue(listOf(true, rows, { nextCursor: 'c90', total: 200 }));
    const first = await renderServer(Page(opening({ show: '90' })));
    expect(mocks.loadCaseListPage).toHaveBeenCalledWith({}, 'acct-1', 'o1', {
      limit: 90,
      before: undefined,
    });
    expect(textOf(first)).toContain('Show Older Entries');
    expect(first).toContain('href="/app/agency/o1/cases?before=c90&amp;from=91#agency-case-list"');

    mocks.loadCaseListPage.mockResolvedValue(
      listOf(true, rows, { nextCursor: 'c180', total: 200 }),
    );
    const older = await renderServer(Page(opening({ before: 'c90', from: '91' })));
    expect(mocks.loadCaseListPage).toHaveBeenLastCalledWith({}, 'acct-1', 'o1', {
      limit: 90,
      before: 'c90',
    });
    const text = textOf(older);
    expect(text).toContain('Showing cases 91 to 180 of 200.');
    expect(text).toContain('Back to the Newest Cases');
    expect(older).toContain(
      'href="/app/agency/o1/cases?before=c180&amp;from=181#agency-case-list"',
    );
    expect(older).toContain('href="/app/agency/o1/cases#agency-case-list"');
  });

  it('caps the open case at 10 notes, with Show More that grows by 10', async () => {
    const notes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }));
    mocks.loadOpenCase.mockResolvedValue(
      openOf({ ...aCase(M1, 'Rahim Uddin'), notes } as never, {
        notesTotal: 37,
        notesNextCursor: 'notes-next',
      }),
    );
    const html = await renderServer(Page(opening({ case: M1 })));
    expect(stubProps<{ notes: unknown[] }>(html, 'MissionCollaboration')[0]?.notes).toHaveLength(
      10,
    );
    expect(textOf(html)).toContain('Showing 10 of 37 notes.');
    expect(html).toContain(`href="/app/agency/o1/cases?case=${M1}&amp;notes=20#notes-${M1}"`);
  });

  it('reads more notes when asked, and past 100 continues with older pages', async () => {
    mocks.loadOpenCase.mockResolvedValue(
      openOf(
        {
          ...aCase(M1, 'Rahim Uddin'),
          notes: Array.from({ length: 100 }, (_, i) => ({ id: `n${i}` })),
        } as never,
        { notesTotal: 400, notesNextCursor: 'older' },
      ),
    );
    const html = await renderServer(Page(opening({ case: M1, notes: '100' })));
    expect(mocks.loadOpenCase.mock.calls[0]?.[5]).toEqual({
      notesLimit: 100,
      notesBefore: undefined,
    });
    expect(html).toContain(
      `href="/app/agency/o1/cases?case=${M1}&amp;notesBefore=older&amp;notesFrom=101#notes-${M1}"`,
    );
    expect(textOf(html)).toContain('Show Older Entries');
    await renderServer(Page(opening({ case: M1, notesBefore: 'older' })));
    expect(mocks.loadOpenCase.mock.calls[1]?.[5]).toEqual({
      notesLimit: 100,
      notesBefore: 'older',
    });
  });
});

describe('agency Cases: where each case stands (WP-V4, E02)', () => {
  type Triage = {
    state: string;
    stateLabel: string;
    groups: {
      group: string;
      label: string;
      items: { label: string; notes: string[]; due: string | null }[];
    }[];
    requestsLeftOut: boolean;
  };
  const triageOf = async () =>
    stubProps<{ missionId: string; triage: Triage }>(
      await renderServer(Page(opening({ case: M1 }))),
      'MissionCollaboration',
    );

  const withChecklist = {
    ...aCase(M1, 'Rahim Uddin'),
    manualMode: false,
    requirements: [
      { id: 'q1', label: 'Passport Number' },
      { id: 'q2', label: 'Bank Statement' },
    ],
    readiness: {
      overallState: 'NEEDS_ACTION',
      requirementResults: [
        {
          packRequirementId: 'q1',
          kind: 'FIELD',
          key: 'passport_number',
          optional: false,
          state: 'SATISFIED',
        },
        {
          packRequirementId: 'q2',
          kind: 'DOCUMENT',
          key: 'BANK_STATEMENT',
          optional: false,
          state: 'CRITICAL_GAP',
        },
      ],
    },
  };

  it('gives an administrator one group per item, with requests that name the case', async () => {
    mocks.loadOpenCase.mockResolvedValue(openOf(withChecklist));
    mocks.loadEvidenceRequests.mockResolvedValue([
      {
        id: 'r1',
        missionId: M1,
        packRequirementId: 'q2',
        kind: 'DOCUMENT',
        fieldKey: null,
        docType: 'BANK_STATEMENT',
        status: 'NEEDS_REPLACEMENT',
        dueDate: new Date('2026-11-02T00:00:00.000Z'),
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      // Another case of the same traveller: never counted here.
      {
        id: 'r2',
        missionId: 'm9',
        packRequirementId: 'q1',
        kind: 'FIELD',
        fieldKey: 'passport_number',
        docType: null,
        status: 'OPEN',
        dueDate: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ]);
    const [workspace] = await triageOf();
    expect(workspace?.triage.stateLabel).toBe('Not Ready for Review');
    expect(workspace?.triage.groups.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Received or Awaiting Confirmation', ['Passport Number']],
      ['Needs Correction or Clarification', ['Bank Statement']],
    ]);
    expect(workspace?.triage.groups[1]?.items[0]?.notes).toEqual(['Sent Back for a Fix']);
    expect(workspace?.triage.groups[1]?.items[0]?.due).not.toBeNull();
    expect(workspace?.triage.requestsLeftOut).toBe(false);
    expect(JSON.stringify(workspace?.triage)).not.toContain('Reviewed');
  });

  it('keeps a request with no case out of the case summary', async () => {
    mocks.loadOpenCase.mockResolvedValue(openOf(withChecklist));
    const sentBack = {
      id: 'r9',
      kind: 'DOCUMENT',
      fieldKey: null,
      docType: 'BANK_STATEMENT',
      status: 'NEEDS_REPLACEMENT',
      dueDate: null,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    // With no case it is only for the ask form's marks...
    mocks.loadEvidenceRequests.mockResolvedValue([{ ...sentBack, missionId: null }]);
    const [without] = await triageOf();
    expect(without?.triage.groups.map((g) => g.label)).not.toContain(
      'Needs Correction or Clarification',
    );
    // ...while the same request naming this case does reach the summary (the positive control).
    mocks.loadEvidenceRequests.mockResolvedValue([{ ...sentBack, missionId: M1 }]);
    const [named] = await triageOf();
    expect(named?.triage.groups.map((g) => g.label)).toContain('Needs Correction or Clarification');
  });

  it('builds a member summary from the checklist only, and says requests are for administrators', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    mocks.loadMembers.mockResolvedValue([]);
    mocks.loadOpenCase.mockResolvedValue(openOf(withChecklist));
    // Even if requests reached the page, a member's summary would not use them.
    mocks.loadEvidenceRequests.mockResolvedValue([
      {
        id: 'r1',
        missionId: M1,
        packRequirementId: 'q2',
        kind: 'DOCUMENT',
        fieldKey: null,
        docType: 'BANK_STATEMENT',
        status: 'RECEIVED',
        dueDate: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ]);
    const [workspace] = await triageOf();
    expect(mocks.loadEvidenceRequests).toHaveBeenCalledWith(
      {},
      'acct-1',
      'o1',
      { org: { id: 'o1' }, admin: false, member: true },
      {
        withFileStates: true,
        forCase: { missionId: M1, applicantId: `ap-${M1}`, alsoWaitingWithoutCase: true },
      },
    );
    expect(workspace?.triage.groups.map((g) => g.label)).toEqual([
      'Missing',
      'Received or Awaiting Confirmation',
    ]);
    expect(workspace?.triage.requestsLeftOut).toBe(true);
  });

  it('never calls a case checked by hand Ready for Review', async () => {
    mocks.loadOpenCase.mockResolvedValue(
      openOf({ ...withChecklist, manualMode: true, readiness: null } as never),
    );
    const [workspace] = await triageOf();
    expect(workspace?.triage.state).toBe('CHECKED_BY_HAND');
    expect(workspace?.triage.stateLabel).toBe('Checked by Hand');
  });
});
