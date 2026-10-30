import { describe, expect, it, vi } from 'vitest';

vi.mock('./server-error', () => ({ reportServerError: vi.fn() }));

const { executeDueDowngrades } = await import('./jobs');

describe('the daily downgrade sweep (S29 round 2)', () => {
  it('counts what it applied and reports every refused downgrade through the error channel', async () => {
    const report = vi.fn();
    const executed = await executeDueDowngrades({} as never, {
      list: (async () => [{ id: 'd1' }, { id: 'd2' }]) as never,
      execute: (async (_db: unknown, input: { downgradeId: string }) =>
        input.downgradeId === 'd1'
          ? { ok: true, value: {} }
          : {
              ok: false,
              error: { code: 'invalid', message: 'the target plan can no longer be given' },
            }) as never,
      report,
    });
    expect(executed).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toBe('triggerDowngradeSweep');
    expect(report.mock.calls[0]?.[2]).toEqual({
      step: 'execute',
      downgradeId: 'd2',
      code: 'invalid',
    });
  });
});
