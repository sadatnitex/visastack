import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  isPlatformOwnerAccount: vi.fn(),
  listActivePlatformRoles: vi.fn(),
  listInvitations: vi.fn(),
  reportUnboundAccounts: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  isPlatformAdmin: mocks.isPlatformAdmin,
  isPlatformOwnerAccount: mocks.isPlatformOwnerAccount,
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listActivePlatformRoles: (...args: unknown[]) => mocks.listActivePlatformRoles(...args),
  listInvitations: (...args: unknown[]) => mocks.listInvitations(...args),
  reportUnboundAccounts: (...args: unknown[]) => mocks.reportUnboundAccounts(...args),
}));
vi.mock('../action-buttons', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return {
    RevokeInvitationButton: stub('RevokeInvitationButton'),
    RevokeRoleButton: stub('RevokeRoleButton'),
  };
});
vi.mock('../admin-forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { GrantRoleForm: stub('GrantRoleForm'), InviteForm: stub('InviteForm') };
});

const { default: Page } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/access';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.isPlatformOwnerAccount.mockResolvedValue(true);
  mocks.listActivePlatformRoles.mockResolvedValue([
    { id: 'r1', role: 'PLATFORM_OWNER', assignedAt: new Date('2026-09-01'), reason: 'Founder' },
  ]);
  mocks.listInvitations.mockResolvedValue([
    {
      id: 'i1',
      email: 'pending@example.com',
      reason: 'Pilot tester',
      invitedAt: new Date('2026-09-02'),
      acceptedAt: null,
      revokedAt: null,
    },
    {
      id: 'i2',
      email: 'accepted@example.com',
      reason: null,
      invitedAt: new Date('2026-09-03'),
      acceptedAt: new Date('2026-09-04'),
      revokedAt: null,
    },
    {
      id: 'i3',
      email: 'revoked@example.com',
      reason: 'Left the pilot',
      invitedAt: new Date('2026-09-05'),
      acceptedAt: null,
      revokedAt: new Date('2026-09-06'),
    },
  ]);
  mocks.reportUnboundAccounts.mockResolvedValue([]);
});

describe('Platform > Access', () => {
  it('shows who holds a role and the state of every pilot invitation', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Platform roles');
    expect(text).toContain('Platform owner');
    expect(text).toContain('Founder');
    expect(text).toContain('Pending');
    expect(text).toContain('Accepted');
    expect(text).toContain('Revoked');
    expect(text).toContain('No reason given');
  });

  it('lets a platform owner grant and revoke, and revoke only an invitation not already revoked', async () => {
    const html = await renderServer(Page());
    expect(stubProps(html, 'GrantRoleForm')).toHaveLength(1);
    expect(stubProps(html, 'InviteForm')).toHaveLength(1);
    expect(stubProps<{ grantId: string }>(html, 'RevokeRoleButton').map((p) => p.grantId)).toEqual([
      'r1',
    ]);
    expect(
      stubProps<{ invitationId: string }>(html, 'RevokeInvitationButton').map(
        (p) => p.invitationId,
      ),
    ).toEqual(['i1', 'i2']);
  });

  it('tells an administrator who is not an owner that only an owner can change this', async () => {
    mocks.isPlatformOwnerAccount.mockResolvedValue(false);
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(stubProps(html, 'GrantRoleForm')).toHaveLength(0);
    expect(stubProps(html, 'RevokeRoleButton')).toHaveLength(0);
    expect(text).toContain('Only a platform owner can grant or revoke roles.');
    expect(text).toContain('Only a platform owner can invite or revoke pilot access.');
  });

  it('explains legacy references without claiming current Neon sign-in is missing', async () => {
    expect(textOf(await renderServer(Page()))).not.toContain('Legacy sign-in references');
    mocks.reportUnboundAccounts.mockResolvedValue([
      { id: 'a1', email: 'old@example.com', createdAt: new Date('2026-08-01'), applicantCount: 2 },
    ]);
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Legacy sign-in references');
    expect(text).toContain('even when its current sign-in works');
    expect(text).not.toContain('resolves itself');
    expect(text).not.toContain('column becomes required');
    expect(text).toContain('old@example.com');
    expect(text).toContain('2 applicants');
  });

  it('refuses anyone who is not a platform administrator, without reading roles or invitations', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('restricted to platform administrators');
    expect(mocks.listActivePlatformRoles).not.toHaveBeenCalled();
    expect(mocks.listInvitations).not.toHaveBeenCalled();
  });

  it('keeps showing the rest of the page when one list cannot be read, and says which', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.listInvitations.mockRejectedValue(new Error('relation does not exist'));
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Some sections could not be loaded');
    expect(text).toContain('invitations');
    expect(text).toContain('Platform owner');
  });
});
