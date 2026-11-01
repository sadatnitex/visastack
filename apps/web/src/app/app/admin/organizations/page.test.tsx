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
  mocks.listAllOrganizations.mockResolvedValue({ items: orgs, nextCursor: null });
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

  it('reads one page of 25 with the filters from the address, and ignores an unknown status', async () => {
    await renderServer(
      Page({ searchParams: Promise.resolve({ q: '  Visa  ', status: 'ACTIVE', before: 'abc_123' }) }),
    );
    expect(mocks.listAllOrganizations).toHaveBeenLastCalledWith(
      {},
      { limit: 25, search: 'Visa', status: 'ACTIVE', before: 'abc_123' },
    );
    await renderServer(
      Page({ searchParams: Promise.resolve({ status: 'toString', before: '<bad cursor>' }) }),
    );
    expect(mocks.listAllOrganizations).toHaveBeenLastCalledWith({}, { limit: 25 });
  });

  it('offers the next page with the filters kept, and a way back to the first page', async () => {
    mocks.listAllOrganizations.mockResolvedValue({ items: orgs, nextCursor: 'next_cursor' });
    const html = await renderServer(
      Page({ searchParams: Promise.resolve({ q: 'Visa', before: 'prev_cursor' }) }),
    );
    expect(html).toContain(
      'href="/app/admin/organizations?q=Visa&amp;before=next_cursor#admin-organizations"',
    );
    expect(textOf(html)).toContain('Next Page');
    expect(html).toContain('href="/app/admin/organizations?q=Visa#admin-organizations"');
    expect(textOf(html)).toContain('Back to the First Page');
    expect(html).toContain('role="search"');
    expect(textOf(html)).toContain('Clear Filters');
  });

  it('keeps suspend, terminate and manage in a row menu named for its organization', async () => {
    mocks.isPlatformOwnerAccount.mockResolvedValue(true);
    const html = await renderServer(Page());
    expect(html.match(/class="sb7-row-menu"/g)).toHaveLength(4);
    expect(textOf(html)).toContain('More Actions for Active Visa Desk');
    mocks.isPlatformOwnerAccount.mockResolvedValue(false);
    const asAdmin = await renderServer(Page());
    // Pending and closed organizations have nothing behind a menu for a non-owner.
    expect(asAdmin.match(/class="sb7-row-menu"/g)).toHaveLength(2);
  });

  it('says when nothing matches the filters instead of claiming there are no organizations', async () => {
    mocks.listAllOrganizations.mockResolvedValue({ items: [], nextCursor: null });
    const html = await renderServer(Page({ searchParams: Promise.resolve({ q: 'zzz' }) }));
    expect(textOf(html)).toContain('No organizations match these filters.');
    expect(textOf(html)).not.toContain('No Organizations Yet');
  });
});
