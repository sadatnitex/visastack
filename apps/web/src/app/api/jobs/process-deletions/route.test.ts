import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sweep: vi.fn(),
  erasure: vi.fn(),
  purge: vi.fn(),
}));
vi.mock('../../../../lib/jobs', () => ({
  triggerAccountDeletionSweep: mocks.sweep,
  triggerErasureWorker: mocks.erasure,
}));
vi.mock('../../../../lib/lifecycle-jobs/traveller-purge', () => ({
  runTravellerPurge: mocks.purge,
}));

const { GET } = await import('./route');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
  mocks.sweep.mockResolvedValue({ executed: 0 });
  mocks.erasure.mockResolvedValue({ processed: 0, blocked: 0, failed: 0 });
  mocks.purge.mockResolvedValue({ removed: 1, restored: 0, failed: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const request = (secret = 'synthetic-cron') =>
  new Request('https://example.com/api/jobs/process-deletions', {
    headers: { authorization: `Bearer ${secret}` },
  });

it('fails closed without a scheduler secret, and refuses a wrong one, running nothing', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(request())).status).toBe(503);
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
  expect((await GET(request('wrong'))).status).toBe(403);
  expect(mocks.sweep).not.toHaveBeenCalled();
  expect(mocks.purge).not.toHaveBeenCalled();
});

it('runs the traveller purge with the deletion job scope and reports its counts', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    executed: 0,
    erasure: { processed: 0, blocked: 0, failed: 0 },
    travellers: { removed: 1, restored: 0, failed: 0 },
  });
  expect(mocks.purge).toHaveBeenCalledTimes(1);
  const [scope] = mocks.purge.mock.calls[0] ?? [];
  expect(scope).toMatchObject({ kind: 'system', job: 'process-deletions' });
});
