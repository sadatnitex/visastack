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
    value: { members: [], nextCursor: null },
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
});
