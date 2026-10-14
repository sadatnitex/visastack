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
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../console-data', () => mocks);
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
  tasks: [{ id: 't1' }],
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
