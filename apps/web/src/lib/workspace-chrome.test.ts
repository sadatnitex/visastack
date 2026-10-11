import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  listApplicants: vi.fn(),
  listMembershipsForAccount: vi.fn(),
  isPlatformAdmin: vi.fn(),
  isPlatformOwnerAccount: vi.fn(),
  hasPlatformPermission: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@visastack/services', () => ({
  listApplicants: mocks.listApplicants,
  listMembershipsForAccount: mocks.listMembershipsForAccount,
}));
vi.mock('./admin', () => ({
  isPlatformAdmin: mocks.isPlatformAdmin,
  isPlatformOwnerAccount: mocks.isPlatformOwnerAccount,
  hasPlatformPermission: mocks.hasPlatformPermission,
}));
const { loadWorkspaceChrome } = await import('./workspace-chrome');
const actor = { accountId: 'synthetic-account', email: 'synthetic@example.test' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listApplicants.mockResolvedValue([
    { id: 'self', displayName: 'Synthetic Self', relationship: 'SELF' },
  ]);
  mocks.listMembershipsForAccount.mockResolvedValue([
    { organization: { id: 'own', name: 'Own Agency' }, active: true, role: 'OWNER' },
    { organization: { id: 'revoked', name: 'Revoked Agency' }, active: false, role: 'ADMIN' },
  ]);
  mocks.isPlatformAdmin.mockResolvedValue(false);
});
describe('workspace chrome uses existing actor-scoped authorization reads', () => {
  it('passes the trusted actor to both owner and membership reads and excludes inactive contexts', async () => {
    const data = await loadWorkspaceChrome({} as never, actor);
    expect(mocks.listApplicants).toHaveBeenCalledWith({}, actor.accountId);
    expect(mocks.listMembershipsForAccount).toHaveBeenCalledWith({}, actor.accountId);
    expect(data.agencies).toEqual([{ id: 'own', name: 'Own Agency', admin: true }]);
    expect(data.accountName).toBe('Synthetic Self');
    expect(data.platform).toBeNull();
    expect(mocks.hasPlatformPermission).not.toHaveBeenCalled();
  });
  it('does not replace account identity with a managed family member or infer rights from email', async () => {
    mocks.listApplicants.mockResolvedValue([
      { id: 'child', displayName: 'Synthetic Child', relationship: 'MINOR_GUARDIAN' },
    ]);
    const data = await loadWorkspaceChrome({} as never, actor);
    expect(data.accountName).toBe('Your account');
    expect(data.platform).toBeNull();
  });
  it('carries only concern permissions proven by the current server checks', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(true);
    mocks.isPlatformOwnerAccount.mockResolvedValue(false);
    mocks.hasPlatformPermission.mockImplementation(
      async (_db, _actor, permission) => permission === 'AI_SETTINGS_MANAGE',
    );
    const data = await loadWorkspaceChrome({} as never, actor);
    expect(data.platform).toEqual({ owner: false, ai: true, complaints: false });
    expect(mocks.isPlatformOwnerAccount).toHaveBeenCalledWith({}, actor);
  });
  it('does not fabricate empty successful contexts when their reads fail', async () => {
    mocks.listMembershipsForAccount.mockRejectedValue(new Error('Unavailable'));
    await expect(loadWorkspaceChrome({} as never, actor)).rejects.toThrow('Unavailable');
  });
});
