import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as intake } from '../app/api/jobs/process-intake/route';
import { GET as sweeps } from '../app/api/jobs/process-notification-sweeps/route';

const mocks = vi.hoisted(() => ({ intake: vi.fn(), sweeps: vi.fn() }));
vi.mock('./jobs', () => ({
  triggerIntakeWorker: mocks.intake,
  triggerNotificationSweeps: mocks.sweeps,
}));
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
const request = () =>
  new Request('https://example.com', { headers: { authorization: 'Bearer synthetic-cron' } });
for (const [name, route, worker] of [
  ['intake', intake, mocks.intake],
  ['sweeps', sweeps, mocks.sweeps],
] as const) {
  it(`${name} refuses anonymous scheduling before running work`, async () => {
    expect((await route(new Request('https://example.com'))).status).toBe(403);
    expect(worker).not.toHaveBeenCalled();
  });
  it(`${name} fails closed without the secret`, async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await route(request())).status).toBe(503);
    expect(worker).not.toHaveBeenCalled();
  });
  it(`${name} exposes outages to its scheduler`, async () => {
    worker.mockResolvedValue({ unavailable: true });
    const response = await route(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
}
