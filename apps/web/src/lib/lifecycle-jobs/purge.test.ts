import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../server-error', () => ({ reportServerError: vi.fn() }));

const { runRecentlyDeletedPurge } = await import('./purge');

const scope = {} as Parameters<typeof runRecentlyDeletedPurge>[0];

describe('runRecentlyDeletedPurge', () => {
  it('runs the purge with the job scope and closes the connection', async () => {
    const end = vi.fn(async () => undefined);
    const purge = vi.fn(async () => ({ queued: 2, removed: 1, blocked: 0, failed: 0 }));
    const result = await runRecentlyDeletedPurge(scope, {
      purge: purge as never,
      connect: () => ({ db: {} as never, end }),
    });
    expect(result).toEqual({ queued: 2, removed: 1, blocked: 0, failed: 0 });
    expect(purge).toHaveBeenCalledWith({}, scope);
    expect(end).toHaveBeenCalledOnce();
  });

  it('never throws, so the erasure worker still runs after a failed purge', async () => {
    const end = vi.fn(async () => undefined);
    const result = await runRecentlyDeletedPurge(scope, {
      purge: (async () => {
        throw new Error('database unavailable');
      }) as never,
      connect: () => ({ db: {} as never, end }),
    });
    expect(result).toEqual({ queued: 0, removed: 0, blocked: 0, failed: 0 });
    expect(end).toHaveBeenCalledOnce();
  });

  it('does nothing without a database', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runRecentlyDeletedPurge(scope, { connect: () => null });
    expect(result.queued).toBe(0);
    error.mockRestore();
  });
});
