import type { Db, SystemScope } from '@visastack/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sweep = vi.hoisted(() => vi.fn());
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  sweepRemovalRequests: sweep,
}));
vi.mock('../server-error', () => ({ reportServerError: vi.fn() }));

import { runRemovalAlerts } from './removal-alerts';

const scope = {} as SystemScope<'process-notification-sweeps'>;
const db = {} as Db;
const NAME = 'DOCUMENT_REMOVAL_REQUESTS';

describe('removal request alerts in the notification sweep', () => {
  const before = process.env[NAME];
  beforeEach(() => {
    sweep.mockReset();
    sweep.mockResolvedValue({ ok: true, value: { completed: 1, kept: 0, alerted: 2 } });
  });
  afterEach(() => {
    if (before === undefined) delete process.env[NAME];
    else process.env[NAME] = before;
  });

  it('completes removals but sends no staff alerts while the switch is off', async () => {
    delete process.env[NAME];
    const result = await runRemovalAlerts(scope, { db });
    expect(result).toEqual({ completed: 1, kept: 0, alerted: 2 });
    expect(sweep).toHaveBeenCalledWith(scope, db, { alerts: false, alertAfterWorkingDays: 3 });
  });

  it('alerts staff after 3 working days once the owner switches requests on', async () => {
    process.env[NAME] = 'on';
    const now = new Date('2026-11-06T10:00:00Z');
    await runRemovalAlerts(scope, { db, now });
    expect(sweep).toHaveBeenCalledWith(scope, db, { alerts: true, alertAfterWorkingDays: 3, now });
  });

  it('never throws: a refused or failed pass is reported as unavailable', async () => {
    sweep.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden', message: 'no' } });
    expect(await runRemovalAlerts(scope, { db })).toMatchObject({ unavailable: true });
    sweep.mockRejectedValueOnce(new Error('database down'));
    expect(await runRemovalAlerts(scope, { db })).toMatchObject({ unavailable: true });
  });
});
