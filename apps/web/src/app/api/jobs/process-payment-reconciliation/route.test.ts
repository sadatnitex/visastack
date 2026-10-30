import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({ triggerPaymentReconciliation: mocks.reconcile }));
beforeEach(() => {
  mocks.reconcile.mockReset();
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const request = () =>
  new Request('https://example.com/api/jobs/process-payment-reconciliation', {
    headers: { authorization: 'Bearer synthetic-cron' },
  });

it('fails closed without a scheduler secret', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(request())).status).toBe(503);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('refuses anonymous and wrongly signed requests without asking the gateway about anything', async () => {
  const anonymous = new Request('https://example.com/api/jobs/process-payment-reconciliation');
  expect((await GET(anonymous)).status).toBe(403);
  const wrong = new Request('https://example.com/api/jobs/process-payment-reconciliation', {
    headers: { authorization: 'Bearer something-else' },
  });
  expect((await GET(wrong)).status).toBe(403);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('returns the counts of a finished run, and runs under its own job scope', async () => {
  const counts = {
    available: true,
    configured: true,
    checked: 2,
    recorded: 1,
    held: 0,
    closed: 1,
    stillPending: 0,
    unavailable: 0,
  };
  mocks.reconcile.mockResolvedValue(counts);
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(counts);
  expect(mocks.reconcile.mock.calls[0]?.[0]).toMatchObject({
    kind: 'system',
    job: 'process-payment-reconciliation',
  });
});
it('does not read as finished when the run could not start or the table is missing', async () => {
  mocks.reconcile.mockResolvedValue({ error: 'not_configured' });
  expect((await GET(request())).status).toBe(503);
  mocks.reconcile.mockResolvedValue({ available: false, configured: true, checked: 0 });
  expect((await GET(request())).status).toBe(503);
});
it('reads as failed when every payment asked about could not be answered (a wrong store setting looks like this)', async () => {
  mocks.reconcile.mockResolvedValue({
    available: true,
    configured: true,
    checked: 3,
    unavailable: 3,
    recorded: 0,
  });
  expect((await GET(request())).status).toBe(503);
  mocks.reconcile.mockResolvedValue({
    available: true,
    configured: true,
    checked: 3,
    unavailable: 1,
    recorded: 2,
  });
  expect((await GET(request())).status).toBe(200);
});

it('reads as failed when the refund check crashed or no sent refund could be asked about (S18)', async () => {
  const payments = {
    available: true,
    configured: true,
    checked: 1,
    recorded: 1,
    held: 0,
    closed: 0,
    stillPending: 0,
    unavailable: 0,
  };
  mocks.reconcile.mockResolvedValue({ ...payments, refunds: { error: 'failed' } });
  expect((await GET(request())).status).toBe(503);
  mocks.reconcile.mockResolvedValue({
    ...payments,
    refunds: { available: true, configured: true, checked: 2, unavailable: 2 },
  });
  expect((await GET(request())).status).toBe(503);
  mocks.reconcile.mockResolvedValue({
    ...payments,
    refunds: { available: false, configured: true, checked: 0, unavailable: 0 },
  });
  expect((await GET(request())).status).toBe(200);
  mocks.reconcile.mockResolvedValue({
    ...payments,
    refunds: { available: true, configured: true, checked: 2, unavailable: 1 },
  });
  expect((await GET(request())).status).toBe(200);
  // Time ran out before any sent refund was asked about: nothing answered.
  mocks.reconcile.mockResolvedValue({
    ...payments,
    refunds: { available: true, configured: true, checked: 0, unavailable: 0, leftForLater: 3 },
  });
  expect((await GET(request())).status).toBe(503);
  mocks.reconcile.mockResolvedValue({
    ...payments,
    refunds: { available: true, configured: true, checked: 1, unavailable: 0, leftForLater: 3 },
  });
  expect((await GET(request())).status).toBe(200);
});
