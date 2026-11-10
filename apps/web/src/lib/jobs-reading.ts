import 'server-only';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import {
  type AiReadingWorkerResult,
  type IntakeWorkerResult,
  type SystemScope,
  runAiReadingWorker,
  runIntakeWorker,
} from '@visastack/services';
import { createAiReadingPorts } from './ai-reading-ports';
import { dispatchGithubIntake } from './github-intake';
import { createMalwareScanner, createObservabilityPort, createStorage } from './providers';
import { createContentLimitsChecker, createDocumentConverter } from './providers-media';
import { reportServerError } from './server-error';

/**
 * The two jobs that read documents (the upload check and the automatic reading). They live apart
 * from `./jobs` on purpose: the deployed server includes the document and image libraries for
 * every page that imports the code that uses them, and `./jobs` is imported by many pages that
 * never read a document.
 */

/**
 * Runs the low-volume durable intake worker on its own short-lived pooled
 * connection (master directive §5: "DB-backed jobs for low pilot volume").
 *
 * This is deliberately NOT given the request's own `db`/pool handle:
 * `withSession` closes its pool in a `finally` block before the Server Action
 * returns, which happens before a `next/server` `after()` callback runs - so
 * reusing that handle here would operate on an already-closed connection.
 * Opening a fresh pooled connection (and closing it when done) is what makes
 * this safe to call from `after()`.
 *
 * Errors are caught and logged, never thrown: the job stays durably PENDING
 * (or retried/parked at FAILED by `runIntakeWorker` itself) in the database
 * regardless of what happens to this particular invocation, so a crash here
 * is not data loss - the next trigger (another upload, or the periodic sweep
 * at `/api/jobs/process-intake`) picks it up.
 */
export async function triggerIntakeWorker(
  options: { readonly limit?: number } = {},
): Promise<IntakeWorkerResult & { readonly queued?: boolean; readonly unavailable?: true }> {
  const provider = 'MALWARE_SCANNER_PROVIDER';
  if (process.env[provider] === 'github_clamav') {
    // Keep jobs PENDING. The isolated runner claims them using the same leases.
    // Dispatch errors propagate to the cron caller; after() reports them.
    await dispatchGithubIntake();
    return { processed: 0, failed: 0, queued: true };
  }
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerIntakeWorker] database not configured');
    return { processed: 0, failed: 0, unavailable: true };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerIntakeWorker', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof runIntakeWorker>[0];
    const storage = createStorage(handle);
    const scanner = createMalwareScanner(storage, { allowPdf: true });
    const extractor = createDocumentConverter(storage);
    const contentLimits = createContentLimitsChecker(storage);
    return await runIntakeWorker(handle, scanner, extractor, contentLimits, {
      ...options,
      observability: createObservabilityPort(),
    });
  } catch (error) {
    reportServerError('triggerIntakeWorker', error, { step: 'worker pass failed' });
    return { processed: 0, failed: 0, unavailable: true };
  } finally {
    await pool.end();
  }
}

/**
 * Runs the automatic AI reading worker (S5, ADR 0019) on its own short-lived pooled connection,
 * for the same reason as `triggerIntakeWorker`. It takes the job's own scope: only the
 * `process-ai-reading` job route (and the helper beside it) can mint one, and the worker refuses
 * anything else. Errors are caught and reported, never thrown: a queued reading stays PENDING (or
 * is retried or parked at FAILED by the worker itself), so a crash here loses nothing.
 */
export async function triggerAiReadingWorker(
  scope: SystemScope<'process-ai-reading'>,
  options: { readonly limit?: number; readonly timeBudgetMs?: number } = {},
): Promise<AiReadingWorkerResult & { readonly unavailable?: true }> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerAiReadingWorker] database not configured');
    return { processed: 0, stopped: 0, failed: 0, unavailable: true };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerAiReadingWorker', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof runAiReadingWorker>[0];
    return await runAiReadingWorker(handle, scope, createAiReadingPorts(handle), {
      ...options,
      observability: createObservabilityPort(),
    });
  } catch (error) {
    reportServerError('triggerAiReadingWorker', error, { step: 'worker pass failed' });
    return { processed: 0, stopped: 0, failed: 0, unavailable: true };
  } finally {
    await pool.end();
  }
}
