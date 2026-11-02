import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sweeps: vi.fn(),
  worker: vi.fn(),
  packages: vi.fn(),
  removals: vi.fn(),
}));
vi.mock('../../../../lib/jobs', () => ({
  triggerNotificationSweeps: mocks.sweeps,
  triggerNotificationWorker: mocks.worker,
  triggerPackageChangeSweep: mocks.packages,
}));
vi.mock('../../../../lib/lifecycle-jobs/removal-alerts', () => ({
  runRemovalAlerts: mocks.removals,
}));
vi.mock('next/server', () => ({ after: (task: () => unknown) => task() }));
vi.mock('@visastack/services', () => ({ systemPrincipal: (job: string) => ({ job }) }));

import { GET } from './route';

const authorized = () =>
  new Request('https://app.example/api/jobs/process-notification-sweeps', {
    headers: { authorization: 'Bearer synthetic-cron' },
  });

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
  mocks.worker.mockResolvedValue(undefined);
  mocks.removals.mockResolvedValue({ alerted: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('daily notification sweeps (UMPE P4 package changes wired in)', () => {
  it('runs the package change sweep after the reminders and reports its counts', async () => {
    mocks.sweeps.mockResolvedValue({ queued: 2 });
    mocks.packages.mockResolvedValue({ checked: 5, recorded: 1, complete: true });
    const response = await GET(authorized());
    expect(response.status).toBe(200);
    expect(mocks.packages).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      queued: 2,
      packages: { checked: 5, recorded: 1, complete: true },
    });
  });

  it('does not reach the package sweep when the reminder sweep is unavailable', async () => {
    mocks.sweeps.mockResolvedValue({ unavailable: true });
    const response = await GET(authorized());
    expect(response.status).toBe(503);
    expect(mocks.packages).not.toHaveBeenCalled();
  });

  it('refuses a request without the cron secret before any sweep runs', async () => {
    const response = await GET(
      new Request('https://app.example/api/jobs/process-notification-sweeps'),
    );
    expect(response.status).toBe(403);
    expect(mocks.sweeps).not.toHaveBeenCalled();
    expect(mocks.packages).not.toHaveBeenCalled();
  });
});
