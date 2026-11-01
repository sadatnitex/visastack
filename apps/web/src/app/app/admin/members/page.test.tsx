import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  isPlatformOwnerAccount: vi.fn(),
  listPlatformMembers: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  isPlatformOwnerAccount: mocks.isPlatformOwnerAccount,
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listPlatformMembers: (...args: unknown[]) => mocks.listPlatformMembers(...args),
}));

const { default: Page } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPlatformOwnerAccount.mockResolvedValue(true);
  mocks.listPlatformMembers.mockResolvedValue({
    ok: true,
    value: { members: [], next: null },
  });
});

describe('Platform > Members', () => {
  it('reads the account directory only after the owner check, which includes the code rule', async () => {
    mocks.isPlatformOwnerAccount.mockResolvedValue(false);
    const text = textOf(await renderServer(Page({ searchParams: Promise.resolve({}) })));
    expect(text).toContain('requires platform owner access');
    expect(mocks.listPlatformMembers).not.toHaveBeenCalled();
  });

  it('lists members for an owner who has passed the check', async () => {
    await renderServer(Page({ searchParams: Promise.resolve({}) }));
    expect(mocks.listPlatformMembers).toHaveBeenCalledTimes(1);
  });

  it('reads 20 newest accounts with the email search and cursor from the address', async () => {
    await renderServer(
      Page({ searchParams: Promise.resolve({ q: '  agent@  ', before: 'cur_1', after: 'old' }) }),
    );
    expect(mocks.listPlatformMembers).toHaveBeenLastCalledWith(
      {},
      { accountId: 'acct-1', email: 'owner@example.com', bootstrapEmails: [] },
      undefined,
      { limit: 20, emailSearch: 'agent@', before: 'cur_1' },
    );
    await renderServer(Page({ searchParams: Promise.resolve({ before: '<script>' }) }));
    expect(mocks.listPlatformMembers).toHaveBeenLastCalledWith(
      {},
      expect.anything(),
      undefined,
      { limit: 20 },
    );
  });

  it('offers the next page with the search kept and a search form', async () => {
    mocks.listPlatformMembers.mockResolvedValue({
      ok: true,
      value: {
        members: [
          {
            id: 'm-1',
            email: 'agent@example.test',
            emailVerifiedAt: null,
            createdAt: new Date('2026-10-01T00:00:00Z'),
          },
        ],
        next: 'cur_2',
      },
    });
    const html = await renderServer(Page({ searchParams: Promise.resolve({ q: 'agent' }) }));
    expect(html).toContain('href="/app/admin/members?q=agent&amp;before=cur_2#members-list"');
    expect(html).toContain('role="search"');
    expect(textOf(html)).toContain('agent@example.test');
    expect(textOf(html)).toContain('Clear Search');
  });

  it('says plainly when the search matches nobody', async () => {
    const html = await renderServer(Page({ searchParams: Promise.resolve({ q: 'nobody' }) }));
    expect(textOf(html)).toContain('No members match this search.');
  });
});
