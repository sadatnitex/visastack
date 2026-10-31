import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ run: vi.fn(), worker: vi.fn(), after: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({
  triggerBillingCycle: mocks.run,
  triggerNotificationWorker: mocks.worker,
}));
vi.mock('next/server', () => ({ after: mocks.after }));
beforeEach(() => {
  mocks.run.mockReset();
  mocks.worker.mockReset();
  mocks.after.mockReset();
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const request = () =>
  new Request('https://example.com/api/jobs/process-billing-cycle', {
    headers: { authorization: 'Bearer synthetic-cron' },
  });
const counts = {
  available: true,
  overdueHandlingEnabled: false,
  invoicesCreated: 2,
  remindersQueued: 1,
  movedToGrace: 0,
  movedToSuspended: 0,
  returnedToActive: 0,
  failed: 0,
  stoppedEarly: false,
  travellerPlans: { renewalInvoicesCreated: 0, remindersQueued: 0, lapsed: 0, failed: 0 },
};

it('fails closed without a scheduler secret, and refuses unsigned requests', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(request())).status).toBe(503);
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
  expect(
    (await GET(new Request('https://example.com/api/jobs/process-billing-cycle'))).status,
  ).toBe(403);
  expect(mocks.run).not.toHaveBeenCalled();
});

it('returns the counts, runs under its own job scope, and sends the queued notices', async () => {
  mocks.run.mockResolvedValue(counts);
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(counts);
  expect(mocks.run.mock.calls[0]?.[0]).toMatchObject({
    kind: 'system',
    job: 'process-billing-cycle',
  });
  expect(mocks.after).toHaveBeenCalledTimes(1);
});

it('does not read as finished when it could not start, before migration 0103, or when everything failed', async () => {
  mocks.run.mockResolvedValue({ error: 'not_configured' });
  expect((await GET(request())).status).toBe(503);
  mocks.run.mockResolvedValue({ ...counts, available: false, invoicesCreated: 0 });
  expect((await GET(request())).status).toBe(503);
  mocks.run.mockResolvedValue({
    ...counts,
    invoicesCreated: 0,
    remindersQueued: 0,
    failed: 3,
  });
  expect((await GET(request())).status).toBe(503);
  mocks.run.mockResolvedValue({ ...counts, failed: 1 });
  expect((await GET(request())).status).toBe(200);
  // A person's renewal made while every agency step failed is still work done (ADR 0025 T4).
  mocks.run.mockResolvedValue({
    ...counts,
    invoicesCreated: 0,
    remindersQueued: 0,
    failed: 2,
    travellerPlans: { renewalInvoicesCreated: 1, remindersQueued: 0, lapsed: 0, failed: 0 },
  });
  expect((await GET(request())).status).toBe(200);
  expect(mocks.after).toHaveBeenCalledTimes(3);
});
