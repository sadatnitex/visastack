import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ worker: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({ triggerNotificationWorker: mocks.worker }));
beforeEach(() => {
  mocks.worker.mockReset();
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const request = () =>
  new Request('https://example.com/api/jobs/process-notifications', {
    headers: { authorization: 'Bearer synthetic-cron' },
  });

it('fails closed without a scheduler secret', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(request())).status).toBe(503);
  expect(mocks.worker).not.toHaveBeenCalled();
});
it('refuses anonymous requests without running a worker', async () => {
  expect(
    (await GET(new Request('https://example.com/api/jobs/process-notifications'))).status,
  ).toBe(403);
  expect(mocks.worker).not.toHaveBeenCalled();
});
it('reports unavailable instead of successful empty work after an outage', async () => {
  mocks.worker.mockResolvedValue({ sent: 0, retrying: 0, failed: 0, unavailable: true });
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'unavailable' });
});
it('stops when a worker releases deferred jobs at the time budget', async () => {
  mocks.worker.mockResolvedValue({ sent: 1, retrying: 0, failed: 0, deferred: 19 });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sent: 1, retrying: 0, failed: 0, deferred: 19 });
  expect(mocks.worker).toHaveBeenCalledTimes(1);
  expect(mocks.worker.mock.calls[0]?.[0].timeBudgetMs).toBeLessThanOrEqual(35_000);
});
it('does not start another batch when the invocation budget is exhausted', async () => {
  let clock = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  mocks.worker.mockImplementation(async () => {
    clock += 36_000;
    return { sent: 20, retrying: 0, failed: 0 };
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(mocks.worker).toHaveBeenCalledTimes(1);
});
