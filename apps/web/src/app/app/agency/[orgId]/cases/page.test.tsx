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
  loadCases: vi.fn(),
  // WP-V4: the page also reads requests (administrator data) for each case's triage summary.
  loadEvidenceRequests: vi.fn(async () => [] as unknown[]),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../console-data', () => mocks);
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../mission-collaboration', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { MissionCollaboration: stub('MissionCollaboration') };
});

const { default: Page } = await import('./page');

const props = { params: Promise.resolve({ orgId: 'o1' }) };

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
  mocks.loadCases.mockResolvedValue({
    admin: true,
    cases: [aCase('m1', 'Rahim Uddin'), aCase('m2', 'Nusrat Jahan')],
  });
});

describe('agency Cases', () => {
  it('gives every visible case a workspace, with the people who can be assigned', async () => {
    const html = await renderServer(Page(props));
    const workspaces = stubProps<{
      missionId: string;
      organizationId: string;
      members: unknown;
      viewerAssigned: boolean;
      applicantName: string;
    }>(html, 'MissionCollaboration');
    expect(workspaces.map((w) => w.missionId)).toEqual(['m1', 'm2']);
    expect(workspaces.every((w) => w.organizationId === 'o1')).toBe(true);
    expect(workspaces[0]?.members).toEqual([{ accountId: 'acct-1', email: 'me@example.com' }]);
    expect(workspaces[0]?.viewerAssigned).toBe(true);
    expect(workspaces[0]?.applicantName).toBe('Rahim Uddin');
  });

  it("never sends a task's own time zone to the browser", async () => {
    const html = await renderServer(Page(props));
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
    mocks.loadCases.mockResolvedValue({ admin: false, cases: [aCase('m1', 'Rahim Uddin')] });
    expect(textOf(await renderServer(Page(props)))).toContain(
      "Leave case notes and record decisions on cases you're assigned to.",
    );
  });

  it('hands the loader the roster it just read, so note authors can be named', async () => {
    await renderServer(Page(props));
    expect(mocks.loadCases).toHaveBeenCalledWith({}, 'acct-1', 'o1', [
      { accountId: 'acct-1', email: 'me@example.com', role: 'OWNER', active: true },
    ]);
  });

  it('explains an empty list differently for an administrator and a member', async () => {
    mocks.loadCases.mockResolvedValue({ admin: true, cases: [] });
    expect(textOf(await renderServer(Page(props)))).toContain('No cases are reachable yet');
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    mocks.loadCases.mockResolvedValue({ admin: false, cases: [] });
    expect(textOf(await renderServer(Page(props)))).toContain(
      "You aren't assigned to any cases yet",
    );
  });

  it('renders nothing, and reads no case, for someone with no role', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: false });
    expect(await renderServer(Page(props))).toBe('');
    expect(mocks.loadCases).not.toHaveBeenCalled();
    expect(mocks.loadMembers).not.toHaveBeenCalled();
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
      await renderServer(Page(props)),
      'MissionCollaboration',
    );

  const withChecklist = {
    ...aCase('m1', 'Rahim Uddin'),
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
    mocks.loadCases.mockResolvedValue({ admin: true, cases: [withChecklist] });
    mocks.loadEvidenceRequests.mockResolvedValue([
      {
        id: 'r1',
        missionId: 'm1',
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
    mocks.loadCases.mockResolvedValue({ admin: false, cases: [withChecklist] });
    // Even if requests reached the page, a member's summary would not use them.
    mocks.loadEvidenceRequests.mockResolvedValue([
      {
        id: 'r1',
        missionId: 'm1',
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
      { withFileStates: true },
    );
    expect(workspace?.triage.groups.map((g) => g.label)).toEqual([
      'Missing',
      'Received or Awaiting Confirmation',
    ]);
    expect(workspace?.triage.requestsLeftOut).toBe(true);
  });

  it('never calls a case checked by hand Ready for Review', async () => {
    mocks.loadCases.mockResolvedValue({
      admin: true,
      cases: [{ ...withChecklist, manualMode: true, readiness: null }],
    });
    const [workspace] = await triageOf();
    expect(workspace?.triage.state).toBe('CHECKED_BY_HAND');
    expect(workspace?.triage.stateLabel).toBe('Checked by Hand');
  });
});
