import 'server-only';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import {
  type Db,
  REMOVAL_ALERT_WORKING_DAYS,
  type RemovalSweepResult,
  type SystemScope,
  sweepRemovalRequests,
} from '@visastack/services';
import { documentRemovalRequestsOn } from '../env';
import { reportServerError } from '../server-error';

export type RemovalAlertsOutcome = RemovalSweepResult & { readonly unavailable?: true };

const NOTHING: RemovalSweepResult = { completed: 0, kept: 0, alerted: 0 };

/**
 * Removal requests in the daily notification sweep (resource lifecycle lane D): marks approved
 * requests Completed once their file is verified gone and tells the person, and, while the owner
 * keeps `DOCUMENT_REMOVAL_REQUESTS` on, alerts compliance staff about any request waiting more
 * than 3 working days. Never throws: a failure is reported and the rest of the sweep carries on.
 * `db` is for tests; the route passes none and a pool is opened for this run.
 */
export async function runRemovalAlerts(
  scope: SystemScope<'process-notification-sweeps'>,
  options: { readonly db?: Db; readonly now?: Date } = {},
): Promise<RemovalAlertsOutcome> {
  const sweep = async (db: Db): Promise<RemovalAlertsOutcome> => {
    const result = await sweepRemovalRequests(scope, db, {
      alerts: documentRemovalRequestsOn(),
      alertAfterWorkingDays: REMOVAL_ALERT_WORKING_DAYS,
      ...(options.now ? { now: options.now } : {}),
    });
    if (result.ok) return result.value;
    reportServerError('runRemovalAlerts', new Error(result.error.message), { step: 'refused' });
    return { ...NOTHING, unavailable: true };
  };
  if (options.db) {
    try {
      return await sweep(options.db);
    } catch (error) {
      reportServerError('runRemovalAlerts', error, { step: 'sweep pass failed' });
      return { ...NOTHING, unavailable: true };
    }
  }
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) return { ...NOTHING, unavailable: true };
  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('runRemovalAlerts', error, { step: 'idle pool connection error' });
  });
  try {
    return await sweep(db as unknown as Db);
  } catch (error) {
    reportServerError('runRemovalAlerts', error, { step: 'sweep pass failed' });
    return { ...NOTHING, unavailable: true };
  } finally {
    await pool.end();
  }
}
