import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  isPlatformOwnerAccount: vi.fn(),
  hasPlatformPermission: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => mocks);

const { default: Page } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/settings';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.isPlatformOwnerAccount.mockResolvedValue(false);
  mocks.hasPlatformPermission.mockResolvedValue(false);
});

describe('Platform > Settings', () => {
  it('shows the Document Protection card to a holder of that permission', async () => {
    mocks.hasPlatformPermission.mockImplementation(
      async (_db: unknown, _actor: unknown, action: string) =>
        action === 'DOCUMENT_PROTECTION_MANAGE',
    );
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('Document Protection');
    expect(textOf(html)).toContain(
      'Choose which documents need a fresh sign-in check before anyone previews or downloads them.',
    );
    expect(html).toContain('href="/app/admin/document-protection"');
    expect(textOf(html)).not.toContain('No Configuration Permission');
  });

  it('shows Billing Rules to the platform owner only', async () => {
    expect(await renderServer(Page())).not.toContain('/app/admin/billing');
    mocks.isPlatformOwnerAccount.mockResolvedValue(true);
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('Billing Rules');
    expect(html).toContain('href="/app/admin/billing"');
  });

  it('hides it from an administrator without that permission', async () => {
    const html = await renderServer(Page());
    expect(html).not.toContain('/app/admin/document-protection');
    expect(textOf(html)).toContain('No Configuration Permission');
  });
});
