import 'server-only';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import { type PurgeDueDocumentsResult, purgeDueDocuments } from '@visastack/services';
import { reportServerError } from '../server-error';

/*
 * The end of Recently Deleted (LC-C, PROGRAMME section 5.1): called from the erasure job route
 * before the erasure worker runs, so a duplicate whose 30 days ended this run is queued and then
 * destroyed in the same run. The scope comes from that route (only job routes may make one).
 */

type ErasureScope = Parameters<typeof purgeDueDocuments>[1];
type PurgeDb = Parameters<typeof purgeDueDocuments>[0];

const NOTHING: PurgeDueDocumentsResult = { queued: 0, removed: 0, blocked: 0, failed: 0 };

/** Start removal of every deleted duplicate whose time is over. Never throws: a failure is reported. */
export async function runRecentlyDeletedPurge(
  scope: ErasureScope,
  options: {
    readonly purge?: typeof purgeDueDocuments;
    readonly connect?: () => { readonly db: PurgeDb; readonly end: () => Promise<void> } | null;
  } = {},
): Promise<PurgeDueDocumentsResult> {
  const connection = (options.connect ?? connectPooled)();
  if (!connection) {
    console.error('[runRecentlyDeletedPurge] database not configured');
    return NOTHING;
  }
  try {
    return await (options.purge ?? purgeDueDocuments)(connection.db, scope);
  } catch (error) {
    reportServerError('runRecentlyDeletedPurge', error, { step: 'purge pass failed' });
    return NOTHING;
  } finally {
    await connection.end();
  }
}

function connectPooled(): { readonly db: PurgeDb; readonly end: () => Promise<void> } | null {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) return null;
  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('runRecentlyDeletedPurge', error, { step: 'idle pool connection error' });
  });
  return { db: db as unknown as PurgeDb, end: () => pool.end() };
}
