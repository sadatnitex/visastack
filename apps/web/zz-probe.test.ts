import { expect, it, vi } from 'vitest';
vi.mock('@playwright/test', () => ({ expect: () => ({}), test: { info: () => ({ annotations: [] }) } }));
it('bundles', async () => {
  const { renderFixture } = await import('./e2e/scroll-budget/support');
  let message = 'NO_ERROR';
  try {
    await renderFixture({ route: async () => { throw new Error('BUNDLED_OK'); } } as never, process.env['PROBE_FIXTURE'] ?? 'zz-probe', {}, { standInServerActions: true });
  } catch (e) { message = (e as Error).message; }
  console.log('RESULT:', message.slice(0, 800));
  expect(message).toBe('BUNDLED_OK');
}, 280000);
