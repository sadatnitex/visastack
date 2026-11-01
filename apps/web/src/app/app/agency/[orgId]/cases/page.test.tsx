import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
}));

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
    MissionCollaboration: ({ notesMore, ...rest }: { notesMore?: ReactNode }) => (
      <>
        <Workspace {...rest} />
        <div data-notes-more="">{notesMore}</div>
      </>
    ),
  };
});

const { default: Page } = await import('./page');

const props = { params: Promise.resolve({ orgId: 'o1' }) };
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
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
    expect(stubProps(html, 'MissionCollaboration')).toEqual([]);
    expect(mocks.loadOpenCase).not.toHaveBeenCalled();
    expect(mocks.loadCases).not.toHaveBeenCalled();
    expect(mocks.loadEvidenceRequests).not.toHaveBeenCalled();
    expect(text).toContain('Choose a case to open its workspace');
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
      { withFileStates: true, forCase: { missionId: M1, applicantId: `ap-${M1}` } },
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
    expect(textOf(await renderServer(Page(props)))).toContain(
      "You aren't assigned to any cases yet",
    );
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
      { withFileStates: true, forCase: { missionId: M1, applicantId: `ap-${M1}` } },
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
