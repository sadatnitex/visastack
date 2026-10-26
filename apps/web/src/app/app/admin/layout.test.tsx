import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../../lib/next-mocks.test-support';
const mocks = vi.hoisted(() => ({ holdsPlatformRole: vi.fn(), staffFactorGate: vi.fn() }));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-admin', email: 'synthetic@example.test' }),
}));
vi.mock('../../../lib/admin', () => ({ holdsPlatformRole: mocks.holdsPlatformRole }));
vi.mock('../../../lib/staff-factor', () => ({ staffFactorGate: mocks.staffFactorGate }));
const { default: Layout } = await import('./layout');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.holdsPlatformRole.mockResolvedValue(true);
  mocks.staffFactorGate.mockResolvedValue({ kind: 'ok' });
});
describe('platform layout keeps the real permission boundary without duplicate navigation', () => {
  it('renders an authorized page without a second horizontal primary bar', async () => {
    const html = await renderServer(Layout({ children: <p id="page">Authorized content</p> }));
    expect(html).toContain('id="page"');
    expect(html).not.toContain('subnav');
    expect(mocks.holdsPlatformRole).toHaveBeenCalledWith(
      {},
      { accountId: 'synthetic-admin', email: 'synthetic@example.test' },
    );
    expect(mocks.staffFactorGate).toHaveBeenCalledWith('synthetic-admin', '/app/admin', {
      anyAge: true,
    });
  });
  it('refuses the entire platform surface when the existing role check fails', async () => {
    mocks.holdsPlatformRole.mockResolvedValue(false);
    const html = await renderServer(Layout({ children: <p id="page">Private content</p> }));
    expect(html).not.toContain('Private content');
    expect(html).toContain('restricted to platform administrators');
    expect(mocks.staffFactorGate).not.toHaveBeenCalled();
  });
  it('sends staff who have not proved a code to the code page, without showing the page', async () => {
    mocks.staffFactorGate.mockResolvedValue({
      kind: 'redirect',
      url: '/app/staff-code?returnTo=%2Fapp%2Fadmin',
    });
    await expect(
      renderServer(Layout({ children: <p id="page">Private content</p> })),
    ).rejects.toThrow('NEXT_REDIRECT:/app/staff-code?returnTo=%2Fapp%2Fadmin');
  });
  it('pauses the platform pages when the code check cannot be made', async () => {
    mocks.staffFactorGate.mockResolvedValue({ kind: 'unavailable' });
    const html = await renderServer(Layout({ children: <p id="page">Private content</p> }));
    expect(html).not.toContain('Private content');
    expect(html).toContain('paused');
  });
});
