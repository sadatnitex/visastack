import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  listApplicants: vi.fn(),
  listMembershipsForAccount: vi.fn(),
  loadWorkspaceToolbarState: vi.fn(),
  holdsPlatformRole: vi.fn(),
  isPlatformOwnerAccount: vi.fn(),
  hasPlatformPermission: vi.fn(),
  agencyCollectionRequestsEnabled: vi.fn(() => false),
  collectionAuthorityOf: vi.fn(
    async (_db: unknown, _accountId: string, _organizationId: string): Promise<string | null> =>
      null,
  ),
}));
vi.mock('server-only', () => ({}));
vi.mock('@visastack/services', () => ({
  listApplicants: mocks.listApplicants,
  listMembershipsForAccount: mocks.listMembershipsForAccount,
  loadWorkspaceToolbarState: mocks.loadWorkspaceToolbarState,
  agencyCollectionRequestsEnabled: mocks.agencyCollectionRequestsEnabled,
  collectionAuthorityOf: mocks.collectionAuthorityOf,
}));
vi.mock('./admin', () => ({
  holdsPlatformRole: mocks.holdsPlatformRole,
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
  mocks.holdsPlatformRole.mockResolvedValue(false);
  mocks.loadWorkspaceToolbarState.mockResolvedValue({
    unread: 0,
    personalPlan: null,
    agencyPlans: [],
  });
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

  it('marks Document Requests for owners and admins only while the switch is on (UMPE P6)', async () => {
    mocks.listMembershipsForAccount.mockResolvedValue([
      { organization: { id: 'own', name: 'Own Agency' }, active: true, role: 'OWNER' },
      { organization: { id: 'work', name: 'Work Agency' }, active: true, role: 'CASE_MANAGER' },
    ]);
    mocks.agencyCollectionRequestsEnabled.mockReturnValueOnce(true);
    const data = await loadWorkspaceChrome({} as never, actor);
    expect(data.agencies).toEqual([
      { id: 'own', name: 'Own Agency', admin: true, collectionRequests: true },
      { id: 'work', name: 'Work Agency', admin: false },
    ]);
  });
  it('marks Document Requests for a member only with May Request Documents, read live (UMPE G3)', async () => {
    mocks.listMembershipsForAccount.mockResolvedValue([
      { organization: { id: 'own', name: 'Own Agency' }, active: true, role: 'OWNER' },
      { organization: { id: 'work', name: 'Work Agency' }, active: true, role: 'CASE_MANAGER' },
      { organization: { id: 'other', name: 'Other Agency' }, active: true, role: 'REVIEWER' },
      { organization: { id: 'broken', name: 'Broken Agency' }, active: true, role: 'REVIEWER' },
    ]);
    mocks.collectionAuthorityOf.mockImplementation(async (_db, _accountId, organizationId) => {
      if (organizationId === 'broken') throw new Error('Unavailable');
      return organizationId === 'work' ? 'REQUESTER' : null;
    });
    mocks.agencyCollectionRequestsEnabled.mockReturnValueOnce(true);
    const data = await loadWorkspaceChrome({} as never, actor);
    expect(data.agencies).toEqual([
      { id: 'own', name: 'Own Agency', admin: true, collectionRequests: true },
      { id: 'work', name: 'Work Agency', admin: false, collectionRequests: true },
      { id: 'other', name: 'Other Agency', admin: false },
      { id: 'broken', name: 'Broken Agency', admin: false },
    ]);
    // Owners and admins need no extra read; members are asked about their own agency only.
    expect(mocks.collectionAuthorityOf.mock.calls.map((call) => call[2])).toEqual([
      'work',
      'other',
      'broken',
    ]);
    expect(mocks.collectionAuthorityOf).toHaveBeenCalledWith({}, actor.accountId, 'work');
  });
  it('asks nothing about request permission while the switch is off (UMPE G3)', async () => {
    mocks.listMembershipsForAccount.mockResolvedValue([
      { organization: { id: 'work', name: 'Work Agency' }, active: true, role: 'CASE_MANAGER' },
    ]);
    const data = await loadWorkspaceChrome({} as never, actor);
    expect(data.agencies).toEqual([{ id: 'work', name: 'Work Agency', admin: false }]);
    expect(mocks.collectionAuthorityOf).not.toHaveBeenCalled();
  });
  it('uses the signed-in account name before any traveller record without changing permissions', async () => {
    const namedActor = { ...actor, displayName: 'Synthetic Noor Agency Owner' };
    const data = await loadWorkspaceChrome({} as never, namedActor);
    expect(data.accountName).toBe('Synthetic Noor Agency Owner');
    expect(data.platform).toBeNull();
    expect(mocks.holdsPlatformRole).toHaveBeenCalledWith({}, namedActor);
  });
  it('does not replace account identity with a managed family member or infer rights from email', async () => {
    mocks.listApplicants.mockResolvedValue([
      { id: 'child', displayName: 'Synthetic Child', relationship: 'MINOR_GUARDIAN' },
    ]);
    const data = await loadWorkspaceChrome({} as never, actor);
    expect(data.accountName).toBe('Your Account');
    expect(data.platform).toBeNull();
  });
  it('carries only concern permissions proven by the current server checks', async () => {
    mocks.holdsPlatformRole.mockResolvedValue(true);
    mocks.isPlatformOwnerAccount.mockResolvedValue(false);
    mocks.hasPlatformPermission.mockImplementation(
      async (_db, _actor, permission) => permission === 'AI_SETTINGS_MANAGE',
    );
    const data = await loadWorkspaceChrome({} as never, actor);
    expect(data.platform).toEqual({
      owner: false,
      ai: true,
      complaints: false,
      audit: false,
      privacy: false,
      removals: false,
      insights: false,
    });
    expect(mocks.isPlatformOwnerAccount).toHaveBeenCalledWith({}, actor);
  });
  it('offers the removal queue only with privacy access and the removal switch on', async () => {
    try {
      mocks.holdsPlatformRole.mockResolvedValue(true);
      mocks.isPlatformOwnerAccount.mockResolvedValue(false);
      let privacy = true;
      mocks.hasPlatformPermission.mockImplementation(
        async (_db, _actor, permission) => privacy && permission === 'APPLICANT_DIRECTORY_VIEW',
      );
      vi.stubEnv('DOCUMENT_REMOVAL_REQUESTS', '');
      expect((await loadWorkspaceChrome({} as never, actor)).platform?.removals).toBe(false);
      vi.stubEnv('DOCUMENT_REMOVAL_REQUESTS', 'on');
      expect((await loadWorkspaceChrome({} as never, actor)).platform?.removals).toBe(true);
      privacy = false;
      expect((await loadWorkspaceChrome({} as never, actor)).platform?.removals).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('does not fabricate empty successful contexts when their reads fail', async () => {
    mocks.listMembershipsForAccount.mockRejectedValue(new Error('Unavailable'));
    await expect(loadWorkspaceChrome({} as never, actor)).rejects.toThrow('Unavailable');
  });
});
