import 'server-only';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import {
  type Db,
  type SystemScope,
  type TravellerPurgeOutcome,
  purgeDueTravellers,
} from '@visastack/services';
import { reportServerError } from '../server-error';

const NOTHING: TravellerPurgeOutcome = { removed: 0, restored: 0, failed: 0 };

/**
 * The traveller purge (LC-E), run by the daily deletion job (`/api/jobs/process-deletions`). Every
 * empty traveller record whose 30 days in Recently Deleted are over is checked again and deleted;
 * one that gained anything meanwhile is restored instead. Before migration 0113 the service does
 * nothing. Never throws: a failure is reported and the job's other work still runs. The job's
 * scope is made by the route itself (only job routes may make one).
 */
export async function runTravellerPurge(
  scope: SystemScope<'process-deletions'>,
  deps: {
    readonly purge?: typeof purgeDueTravellers;
    readonly report?: typeof reportServerError;
    readonly openDb?: () => { readonly db: Db; readonly close: () => Promise<void> } | null;
  } = {},
): Promise<TravellerPurgeOutcome> {
  const purge = deps.purge ?? purgeDueTravellers;
  const report = deps.report ?? reportServerError;
  const opened = (deps.openDb ?? openPooledDb)();
  if (!opened) {
    console.error('[runTravellerPurge] database not configured');
    return NOTHING;
  }
  try {
    const result = await purge(opened.db, scope);
    if (!result.ok) {
      report('runTravellerPurge', new Error(result.error.message), { step: 'refused' });
      return NOTHING;
    }
    if (result.value.failed > 0) {
      report('runTravellerPurge', new Error(`${result.value.failed} record(s) not handled`), {
        step: 'partial',
      });
    }
    return result.value;
  } catch (error) {
    report('runTravellerPurge', error, { step: 'sweep failed' });
    return NOTHING;
  } finally {
    await opened.close();
  }
}

function openPooledDb(): { readonly db: Db; readonly close: () => Promise<void> } | null {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) return null;
  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('runTravellerPurge', error, { step: 'idle pool connection error' });
  });
  return { db: db as unknown as Db, close: () => pool.end() };
}
