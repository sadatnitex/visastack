import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../server-error', () => ({ reportServerError: vi.fn() }));

const { runHeldJobRequeue } = await import('./hold-requeue');

const scope = {} as Parameters<typeof runHeldJobRequeue>[0];

describe('runHeldJobRequeue', () => {
  it('runs the sweep with the job scope and closes the connection', async () => {
    const end = vi.fn(async () => undefined);
    const sweep = vi.fn(async () => ({ requeued: 3, failed: 0 }));
    const result = await runHeldJobRequeue(scope, {
      sweep: sweep as never,
      connect: () => ({ db: {} as never, end }),
    });
    expect(result).toEqual({ requeued: 3, failed: 0 });
    expect(sweep).toHaveBeenCalledWith({}, scope);
    expect(end).toHaveBeenCalledOnce();
  });

  it('never throws, so the erasure worker still runs after a failed sweep', async () => {
    const end = vi.fn(async () => undefined);
    const result = await runHeldJobRequeue(scope, {
      sweep: (async () => {
        throw new Error('database unavailable');
      }) as never,
      connect: () => ({ db: {} as never, end }),
    });
    expect(result).toEqual({ requeued: 0, failed: 0 });
    expect(end).toHaveBeenCalledOnce();
  });

  it('does nothing without a database', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runHeldJobRequeue(scope, { connect: () => null });
    expect(result.requeued).toBe(0);
    error.mockRestore();
  });
});
