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
  listAllOrganizations: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => mocks);
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listAllOrganizations: (...args: unknown[]) => mocks.listAllOrganizations(...args),
}));
vi.mock('../action-buttons', async () => {
  const { stub: make } = await import('../../../../lib/next-mocks.test-support');
  return {
    OrgReviewButtons: make('OrgReviewButtons'),
    OrgSuspendButton: make('OrgSuspendButton'),
    OrgTerminateButton: make('OrgTerminateButton'),
  };
});

const { default: Page } = await import('./page');

const orgs = [
  { id: 'o-pending', name: 'Pending Travel Co', status: 'PENDING_VERIFICATION' },
  { id: 'o-active', name: 'Active Visa Desk', status: 'ACTIVE' },
  { id: 'o-suspended', name: 'Suspended Agents', status: 'SUSPENDED' },
  { id: 'o-closed', name: 'Closed Ltd', status: 'CLOSED' },
];

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/organizations';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.isPlatformOwnerAccount.mockResolvedValue(false);
  mocks.listAllOrganizations.mockResolvedValue(orgs);
});

describe('Platform > Organizations', () => {
  it('shows each organization with only the actions its status allows', async () => {
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('Organizations');
    for (const org of orgs) expect(html).toContain(org.name);
    expect(
      stubProps<{ organizationId: string }>(html, 'OrgReviewButtons').map((p) => p.organizationId),
    ).toEqual(['o-pending']);
    expect(
      stubProps<{ organizationId: string }>(html, 'OrgSuspendButton').map((p) => p.organizationId),
    ).toEqual(['o-active']);
    expect(
      stubProps<{ organizationId: string }>(html, 'OrgTerminateButton').map(
        (p) => p.organizationId,
      ),
    ).toEqual(['o-active', 'o-suspended']);
  });

  it('offers the Manage link only to a platform owner', async () => {
    const asAdmin = await renderServer(Page());
    expect(asAdmin).not.toContain('/app/admin/organizations/o-active');
    mocks.isPlatformOwnerAccount.mockResolvedValue(true);
    const asOwner = await renderServer(Page());
    expect(asOwner).toContain('href="/app/admin/organizations/o-active"');
    expect(asOwner).toContain('>Manage<');
  });

  it('refuses anyone who is not a platform administrator, without reading anything', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('restricted to platform administrators');
    expect(html).not.toContain('Active Visa Desk');
    expect(mocks.listAllOrganizations).not.toHaveBeenCalled();
  });

  it('says plainly when the list could not be read, instead of showing it empty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.listAllOrganizations.mockRejectedValue(
      new Error('relation "organizations" does not exist'),
    );
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('Some Sections Could Not Be Loaded');
    expect(textOf(html)).toContain('organizations');
    expect(textOf(html)).toContain('No Organizations Yet');
  });

  it('keeps an unrelated failure of the permission check an error', async () => {
    mocks.isPlatformAdmin.mockRejectedValue(new Error('permission lookup failed'));
    await expect(Page()).rejects.toThrow('permission lookup failed');
  });
});
