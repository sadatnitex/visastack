import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  pooled: vi.fn(),
  worker: vi.fn(),
  encryption: vi.fn(),
}));
vi.mock('@visastack/db', async (load) => ({
  ...(await load<typeof import('@visastack/db')>()),
  resolveDatabaseUrl: mocks.resolve,
  createPooledDb: mocks.pooled,
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  runNotificationWorker: mocks.worker,
}));
vi.mock('./providers', () => ({
  createEmailPort: vi.fn(() => ({})),
  createKeyManagementPort: mocks.encryption,
}));
vi.mock('./base-url', () => ({ resolveBaseUrl: () => 'https://example.com' }));
vi.mock('./server-error', () => ({ reportServerError: vi.fn() }));
const end = vi.fn();
beforeEach(() => {
  mocks.resolve.mockReturnValue('synthetic-database');
  mocks.pooled.mockReturnValue({ db: {}, pool: { on: vi.fn(), end } });
});
afterEach(() => {
  vi.resetAllMocks();
});

it('reports missing database configuration without pretending the queue is empty', async () => {
  mocks.resolve.mockReturnValue(undefined);
  const { triggerNotificationWorker } = await import('./jobs');
  expect(await triggerNotificationWorker()).toEqual({
    sent: 0,
    retrying: 0,
    failed: 0,
    unavailable: true,
  });
  expect(mocks.pooled).not.toHaveBeenCalled();
  expect(mocks.worker).not.toHaveBeenCalled();
});
it('reports database outages and releases its own pool', async () => {
  mocks.worker.mockRejectedValue(new Error('synthetic database unavailable'));
  const { triggerNotificationWorker } = await import('./jobs');
  expect(await triggerNotificationWorker()).toEqual({
    sent: 0,
    retrying: 0,
    failed: 0,
    unavailable: true,
  });
  expect(end).toHaveBeenCalledOnce();
});
it('passes the bounded budget and preserves the actual worker result', async () => {
  mocks.worker.mockResolvedValue({ sent: 1, retrying: 0, failed: 0, deferred: 2 });
  const { triggerNotificationWorker } = await import('./jobs');
  expect(await triggerNotificationWorker({ limit: 3, timeBudgetMs: 12_000 })).toEqual({
    sent: 1,
    retrying: 0,
    failed: 0,
    deferred: 2,
  });
  expect(mocks.worker.mock.calls[0]?.[3]).toEqual({ limit: 3, timeBudgetMs: 12_000 });
  expect(end).toHaveBeenCalledOnce();
});

it('passes configured invitation encryption to the durable worker', async () => {
  const encryption = { currentKeyVersion: () => 'test-v1' };
  mocks.encryption.mockReturnValue(encryption);
  mocks.worker.mockResolvedValue({ sent: 1, retrying: 0, failed: 0 });
  const { triggerNotificationWorker } = await import('./jobs');
  expect((await triggerNotificationWorker()).sent).toBe(1);
  expect(mocks.worker.mock.calls[0]?.[3]).toEqual({ timeBudgetMs: 35_000, encryption });
  expect(end).toHaveBeenCalledOnce();
});
