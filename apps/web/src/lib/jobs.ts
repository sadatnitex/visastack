import 'server-only';
import { BasicSafetyScanner } from '@visastack/adapters';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import { type IntakeWorkerResult, runIntakeWorker } from '@visastack/services';
import { createStorage } from './storage';

/**
 * Runs the low-volume durable intake worker on its own short-lived pooled
 * connection (master directive §5: "DB-backed jobs for low pilot volume").
 *
 * This is deliberately NOT given the request's own `db`/pool handle:
 * `withSession` closes its pool in a `finally` block before the Server Action
 * returns, which happens before a `next/server` `after()` callback runs — so
 * reusing that handle here would operate on an already-closed connection.
 * Opening a fresh pooled connection (and closing it when done) is what makes
 * this safe to call from `after()`.
 *
 * Errors are caught and logged, never thrown: the job stays durably PENDING
 * (or retried/parked at FAILED by `runIntakeWorker` itself) in the database
 * regardless of what happens to this particular invocation, so a crash here
 * is not data loss — the next trigger (another upload, or the periodic sweep
 * at `/api/jobs/process-intake`) picks it up.
 */
export async function triggerIntakeWorker(
  options: { readonly limit?: number } = {},
): Promise<IntakeWorkerResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerIntakeWorker] database not configured');
    return { processed: 0, failed: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    console.error('[triggerIntakeWorker] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof runIntakeWorker>[0];
    const storage = createStorage(handle);
    const scanner = new BasicSafetyScanner({ blobStore: storage });
    return await runIntakeWorker(handle, scanner, options);
  } catch (error) {
    console.error('[triggerIntakeWorker] worker pass failed', error);
    return { processed: 0, failed: 0 };
  } finally {
    await pool.end();
  }
}
