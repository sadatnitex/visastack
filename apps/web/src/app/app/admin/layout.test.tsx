import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../../lib/next-mocks.test-support';
const mocks = vi.hoisted(() => ({ isPlatformAdmin: vi.fn() }));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-admin', email: 'synthetic@example.test' }),
}));
vi.mock('../../../lib/admin', () => mocks);
const { default: Layout } = await import('./layout');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPlatformAdmin.mockResolvedValue(true);
});
describe('platform layout keeps the real permission boundary without duplicate navigation', () => {
  it('renders an authorized page without a second horizontal primary bar', async () => {
    const html = await renderServer(Layout({ children: <p id="page">Authorized content</p> }));
    expect(html).toContain('id="page"');
    expect(html).not.toContain('subnav');
    expect(mocks.isPlatformAdmin).toHaveBeenCalledWith(
      {},
      { accountId: 'synthetic-admin', email: 'synthetic@example.test' },
    );
  });
  it('refuses the entire platform surface when the existing role check fails', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const html = await renderServer(Layout({ children: <p id="page">Private content</p> }));
    expect(html).not.toContain('Private content');
    expect(html).toContain('restricted to platform administrators');
  });
});
