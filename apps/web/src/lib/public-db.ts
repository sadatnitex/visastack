import 'server-only';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import type { Db } from '@visastack/services';
import { reportServerError } from './server-error';

/**
 * The connection-lifecycle half of `withSession` (session.ts) -- pool
 * creation, the idle-connection error listener, and guaranteed cleanup --
 * with none of the auth/pilot-access/provisioning logic, for a page that is
 * genuinely public and unauthenticated (RUL-06's `/trust` surface). Never
 * add a session/account concern here; that belongs in `withSession` itself.
 */
export async function withPublicDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) throw new Error('database not configured');

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('withPublicDb', error, { step: 'idle pool connection error' });
  });
  try {
    return await fn(db as unknown as Db);
  } finally {
    await pool.end();
  }
}
