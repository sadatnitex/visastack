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
  loadPendingTeamInvitations: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../console-data', () => mocks);
vi.mock('../invitation-revoke-button', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { InvitationRevokeButton: stub('InvitationRevokeButton') };
});
vi.mock('../member-form', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { AddMemberForm: stub('AddMemberForm') };
});
vi.mock('../member-toggle-button', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { MemberToggleButton: stub('MemberToggleButton') };
});

const { default: Page } = await import('./page');

const props = { params: Promise.resolve({ orgId: 'o1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/team';
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([
    {
      membershipId: 'ms1',
      accountId: 'a1',
      email: 'owner@example.com',
      role: 'OWNER',
      active: true,
    },
    {
      membershipId: 'ms2',
      accountId: 'a2',
      email: 'rev@example.com',
      role: 'REVIEWER',
      active: false,
    },
  ]);
  mocks.loadPendingTeamInvitations.mockResolvedValue([
    {
      id: 'inv1',
      email: 'new@example.com',
      role: 'CASE_MANAGER',
      expiresAt: '2026-11-01T00:00:00Z',
    },
  ]);
});

describe('agency Team', () => {
  it('lists members with their role and whether they are active', async () => {
    const text = textOf(await renderServer(Page(props)));
    expect(text).toContain('owner@example.com');
    expect(text).toContain('Owner');
    expect(text).not.toContain('OWNER');
    expect(text).toContain('rev@example.com');
    expect(text).toContain('Reviewer');
    expect(text).not.toContain('REVIEWER');
    expect(text).toContain('Active');
    expect(text).toContain('Inactive');
  });

  it('never offers to deactivate the owner', async () => {
    const html = await renderServer(Page(props));
    expect(
      stubProps<{ membershipId: string }>(html, 'MemberToggleButton').map((p) => p.membershipId),
    ).toEqual(['ms2']);
  });

  it('shows pending invitations with a revoke control, and the add-member form', async () => {
    const html = await renderServer(Page(props));
    expect(textOf(html)).toContain('new@example.com');
    expect(textOf(html)).toContain('Case Manager');
    expect(textOf(html)).not.toContain('CASE_MANAGER');
    expect(textOf(html)).toContain('Invited');
    expect(stubProps(html, 'InvitationRevokeButton')).toEqual([
      { organizationId: 'o1', invitationId: 'inv1' },
    ]);
    expect(stubProps(html, 'AddMemberForm')).toEqual([
      { organizationId: 'o1', pendingInvitationIds: ['inv1'] },
    ]);
  });

  it('tells a member who is not an administrator, and reads no roster for them', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    const html = await renderServer(Page(props));
    expect(textOf(html)).toContain("limited to this organization's owners and admins");
    expect(mocks.loadMembers).not.toHaveBeenCalled();
    expect(mocks.loadPendingTeamInvitations).not.toHaveBeenCalled();
    expect(stubProps(html, 'AddMemberForm')).toHaveLength(0);
  });

  it('renders nothing for someone with no role', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: false });
    expect(await renderServer(Page(props))).toBe('');
    expect(mocks.loadMembers).not.toHaveBeenCalled();
  });
});
