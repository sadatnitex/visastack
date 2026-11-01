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
  staffFactorCoverage: vi.fn(),
  neonSessionRef: vi.fn(),
  createKeyManagementPort: vi.fn(),
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
  staffFactorCoverage: (...args: unknown[]) => mocks.staffFactorCoverage(...args),
}));
vi.mock('../../../../lib/neon-recency', () => ({ neonSessionRef: mocks.neonSessionRef }));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: mocks.createKeyManagementPort,
}));
vi.mock('../action-buttons', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return {
    RevokeInvitationButton: stub('RevokeInvitationButton'),
    RevokeRoleButton: stub('RevokeRoleButton'),
    ResetAuthenticatorButton: stub('ResetAuthenticatorButton'),
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
  mocks.staffFactorCoverage.mockResolvedValue({ staff: 3, enrolled: 1 });
  mocks.neonSessionRef.mockResolvedValue('ref-1');
  mocks.createKeyManagementPort.mockReturnValue({});
  mocks.listActivePlatformRoles.mockResolvedValue([
    { id: 'r1', role: 'PLATFORM_OWNER', assignedAt: new Date('2026-09-01'), reason: 'Founder' },
  ]);
  const invitations = [
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
  ];
  // WP-SB6: the page reads pending invitations and the history as two pages.
  mocks.listInvitations.mockImplementation(async (_db: unknown, options: { view: string }) => {
    const isPending = (inv: (typeof invitations)[number]) => !inv.acceptedAt && !inv.revokedAt;
    const pending = invitations.filter(isPending);
    return {
      items: options.view === 'history' ? invitations.filter((inv) => !isPending(inv)) : pending,
      nextCursor: null,
      view: options.view,
      counts: { pending: pending.length, history: invitations.length - pending.length },
    };
  });
  mocks.reportUnboundAccounts.mockResolvedValue([]);
});

describe('Platform > Access', () => {
  it('shows who holds a role and the state of every pilot invitation', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Platform Roles');
    expect(text).toContain('Platform Owner');
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

  it('says how many staff have set up an authenticator and whether codes can be checked here', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('1 of 3 staff have set one up');
    expect(text).toContain('Codes can be checked here');
    mocks.createKeyManagementPort.mockReturnValue(undefined);
    expect(textOf(await renderServer(Page()))).toContain('Codes cannot be checked here yet');
  });

  it('explains legacy references without claiming current Neon sign-in is missing', async () => {
    expect(textOf(await renderServer(Page()))).not.toContain('Legacy Sign-In References');
    mocks.reportUnboundAccounts.mockResolvedValue([
      { id: 'a1', email: 'old@example.com', createdAt: new Date('2026-08-01'), applicantCount: 2 },
    ]);
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Legacy Sign-In References');
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
    expect(text).toContain('Some Sections Could Not Be Loaded');
    expect(text).toContain('invitations');
    expect(text).toContain('Platform Owner');
  });
});

describe('WP-SB6 access within the scroll budget', () => {
  const inv = (n: number, state: 'pending' | 'accepted' | 'revoked') => ({
    id: `${state}-${n}`,
    email: `${state}-${n}@example.com`,
    reason: 'Pilot tester',
    invitedAt: new Date(Date.UTC(2026, 8, 1) - n * 60_000),
    acceptedAt: state === 'accepted' ? new Date('2026-09-10') : null,
    revokedAt: state === 'revoked' ? new Date('2026-09-11') : null,
  });

  it('lists 25 pending invitations first and the history in a fixed box, each paged by the server', async () => {
    mocks.listInvitations.mockImplementation(async (_db: unknown, options: { view: string }) =>
      options.view === 'history'
        ? {
            items: Array.from({ length: 25 }, (_, n) => inv(n, n % 2 ? 'accepted' : 'revoked')),
            nextCursor: 'HISTORY_NEXT',
            view: 'history',
            counts: { pending: 500, history: 500 },
          }
        : {
            items: Array.from({ length: 25 }, (_, n) => inv(n, 'pending')),
            nextCursor: 'PENDING_NEXT',
            view: 'pending',
            counts: { pending: 500, history: 500 },
          },
    );
    const html = await renderServer(Page({ searchParams: Promise.resolve({}) }));
    expect(mocks.listInvitations).toHaveBeenCalledWith({}, { view: 'pending', limit: 25 });
    expect(mocks.listInvitations).toHaveBeenCalledWith(
      {},
      { view: 'history', limit: 25, withCounts: false },
    );
    expect(html.match(/class="row invitation-row"/g) ?? []).toHaveLength(50);
    // Pending first, then the history inside its own scrolling box.
    expect(html.indexOf('pending-0@example.com')).toBeLessThan(
      html.indexOf('aria-label="Accepted and Revoked Invitations"'),
    );
    expect(html).toContain(
      'class="activity-log-scroll staff-queue-panel" id="pilot-history-panel"',
    );
    expect(html).toContain(
      'href="/app/admin/access?pendingBefore=PENDING_NEXT#pilot-pending-list"',
    );
    expect(html).toContain(
      'href="/app/admin/access?historyBefore=HISTORY_NEXT#pilot-history-panel"',
    );
    expect(textOf(html)).toContain('Showing the newest 25 of 500 invitations.');
  });

  it('keeps the other list where it was while one pages, and offers the way back', async () => {
    await renderServer(
      Page({ searchParams: Promise.resolve({ historyBefore: 'H2', pendingBefore: 'P2' }) }),
    );
    expect(mocks.listInvitations).toHaveBeenCalledWith(
      {},
      { view: 'pending', limit: 25, before: 'P2' },
    );
    expect(mocks.listInvitations).toHaveBeenCalledWith(
      {},
      { view: 'history', limit: 25, withCounts: false, before: 'H2' },
    );
  });
});
