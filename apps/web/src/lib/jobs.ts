import 'server-only';
import { isOk } from '@visastack/core';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import {
  type AbandonedUploadSweepResult,
  type ErasureWorkerResult,
  type IntakeWorkerResult,
  executeAccountDeletion,
  listDueDeletions,
  runErasureWorker,
  runIntakeWorker,
  sweepAbandonedUploads,
} from '@visastack/services';
import {
  createContentLimitsChecker,
  createDocumentConverter,
  createMalwareScanner,
  createStorage,
} from './providers';

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
    const scanner = createMalwareScanner(storage);
    const extractor = createDocumentConverter(storage);
    const contentLimits = createContentLimitsChecker(storage);
    return await runIntakeWorker(handle, scanner, extractor, contentLimits, options);
  } catch (error) {
    console.error('[triggerIntakeWorker] worker pass failed', error);
    return { processed: 0, failed: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Runs the erasure outbox worker (master directive §7 "PR 4") on its own
 * short-lived pooled connection — same rationale as `triggerIntakeWorker`
 * above: never the request's own `db`/pool, since `withSession` closes that
 * pool before an `after()` callback runs.
 */
export async function triggerErasureWorker(
  options: { readonly limit?: number } = {},
): Promise<ErasureWorkerResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerErasureWorker] database not configured');
    return { processed: 0, blocked: 0, failed: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    console.error('[triggerErasureWorker] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof runErasureWorker>[0];
    const storage = createStorage(handle);
    return await runErasureWorker(handle, storage, options);
  } catch (error) {
    console.error('[triggerErasureWorker] worker pass failed', error);
    return { processed: 0, blocked: 0, failed: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Executes every account deletion request whose grace window has elapsed
 * (master directive §7 "PR 4"). This is the only thing that ever calls
 * `executeAccountDeletion` — without it, a request opened via
 * `requestDeletionAction` would sit at PENDING forever. Errors on one account
 * are logged and skipped, never allowed to abort the rest of the sweep.
 */
export async function triggerAccountDeletionSweep(): Promise<{ readonly executed: number }> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerAccountDeletionSweep] database not configured');
    return { executed: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    console.error('[triggerAccountDeletionSweep] idle pool connection error', error);
  });
  let executed = 0;
  try {
    const handle = db as unknown as Parameters<typeof listDueDeletions>[0];
    const due = await listDueDeletions(handle);
    for (const request of due) {
      if (!request.accountId) continue; // already executed elsewhere and tombstoned
      const result = await executeAccountDeletion(handle, { accountId: request.accountId });
      if (isOk(result)) executed++;
      else console.error('[triggerAccountDeletionSweep] execution failed', result.error);
    }
  } catch (error) {
    console.error('[triggerAccountDeletionSweep] sweep failed', error);
  } finally {
    await pool.end();
  }
  return { executed };
}

/**
 * Cleans up upload reservations abandoned mid-request (directive Part 3 §3:
 * "delete abandoned objects/reservations after 24 hours") on its own
 * short-lived pooled connection, same rationale as the workers above.
 */
export async function triggerAbandonedUploadSweep(
  options: { readonly limit?: number } = {},
): Promise<AbandonedUploadSweepResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerAbandonedUploadSweep] database not configured');
    return { checked: 0, cleaned: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    console.error('[triggerAbandonedUploadSweep] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepAbandonedUploads>[0];
    const storage = createStorage(handle);
    return await sweepAbandonedUploads(handle, storage, options.limit);
  } catch (error) {
    console.error('[triggerAbandonedUploadSweep] sweep failed', error);
    return { checked: 0, cleaned: 0 };
  } finally {
    await pool.end();
  }
}
