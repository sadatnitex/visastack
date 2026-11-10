import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sweeps: vi.fn(),
  worker: vi.fn(),
  packages: vi.fn(),
  ruleImpacts: vi.fn(),
  grants: vi.fn(),
  removals: vi.fn(),
}));
vi.mock('../../../../lib/jobs', () => ({
  triggerGrantExpirySweep: mocks.grants,
  triggerNotificationSweeps: mocks.sweeps,
  triggerNotificationWorker: mocks.worker,
  triggerPackageChangeSweep: mocks.packages,
  triggerRuleImpactSweep: mocks.ruleImpacts,
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
  mocks.grants.mockResolvedValue({ checked: 0, enqueued: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('daily notification sweeps (UMPE P4 package changes wired in)', () => {
  it('runs the package change sweep after the reminders and reports its counts', async () => {
    mocks.sweeps.mockResolvedValue({ queued: 2 });
    mocks.packages.mockResolvedValue({ checked: 5, recorded: 1, complete: true });
    mocks.ruleImpacts.mockResolvedValue({ runs: 1, casesFlagged: 2, notesQueued: 2, more: false });
    const response = await GET(authorized());
    expect(response.status).toBe(200);
    expect(mocks.packages).toHaveBeenCalledTimes(1);
    expect(mocks.packages).toHaveBeenCalledWith({ job: 'process-notification-sweeps' });
    expect(mocks.ruleImpacts).toHaveBeenCalledWith({ job: 'process-notification-sweeps' });
    expect(await response.json()).toMatchObject({
      queued: 2,
      packages: { checked: 5, recorded: 1, complete: true },
      ruleImpacts: { runs: 1, casesFlagged: 2, notesQueued: 2, more: false },
    });
  });

  it('runs the sharing-ends-soon reminders under its own scope and reports them', async () => {
    mocks.sweeps.mockResolvedValue({ queued: 0 });
    mocks.packages.mockResolvedValue({ checked: 0, recorded: 0, complete: true });
    mocks.ruleImpacts.mockResolvedValue({ runs: 0, casesFlagged: 0, notesQueued: 0, more: false });
    mocks.grants.mockResolvedValue({ checked: 3, enqueued: 6 });
    const response = await GET(authorized());
    expect(mocks.grants).toHaveBeenCalledWith({ job: 'process-notification-sweeps' });
    expect(await response.json()).toMatchObject({ grantReminders: { checked: 3, enqueued: 6 } });
  });

  it('does not reach the package sweep when the reminder sweep is unavailable', async () => {
    mocks.sweeps.mockResolvedValue({ unavailable: true });
    const response = await GET(authorized());
    expect(response.status).toBe(503);
    expect(mocks.packages).not.toHaveBeenCalled();
    expect(mocks.ruleImpacts).not.toHaveBeenCalled();
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
