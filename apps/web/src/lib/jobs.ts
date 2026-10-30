import 'server-only';
import { JszipBundler } from '@visastack/adapters';
import { isOk } from '@visastack/core';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import {
  type AbandonedClientInvitationSweepResult,
  type AbandonedOrganizationInvitationSweepResult,
  type AbandonedUploadSweepResult,
  type AccountExportExpirySweepResult,
  type AccountExportWorkerResult,
  type AiReadingWorkerResult,
  type BillingCycleSummary,
  type CaseRetentionNoticeSweepResult,
  type CaseRetentionPurgeSweepResult,
  type DataKeyRewrapSummary,
  type ErasureWorkerResult,
  type ExpirySweepResult,
  type InactiveAccountDeletionSweepResult,
  type InactiveAccountNoticeSweepResult,
  type IntakeWorkerResult,
  type LegalHoldReminderSweepResult,
  type NotificationWorkerResult,
  RATE_LIMITS,
  type ReconciliationSummary,
  type RefundCheckSummary,
  type SweepResult,
  type SystemScope,
  applyEmailDeliveryEvent,
  checkRateLimit,
  deleteExpiredAiTokens,
  deleteStaleAiClients,
  executeAccountDeletion,
  executeScheduledDowngrade,
  listDueDeletions,
  listDueDowngrades,
  pruneExpiredRateLimitBuckets,
  reconcilePaymentAttempts,
  reconcileRefunds,
  rewrapDataKeys,
  runAccountExportWorker,
  runAiReadingWorker,
  runBillingCycle,
  runErasureWorker,
  runIntakeWorker,
  runNotificationWorker,
  sweepAbandonedClientInvitations,
  sweepAbandonedOrganizationInvitations,
  sweepAbandonedUploads,
  sweepCaseRetentionNotices,
  sweepCaseRetentionPurge,
  sweepExpiredAccountExportArtifacts,
  sweepExpiryReminders,
  sweepInactiveAccountDeletionRequests,
  sweepInactiveAccountNotices,
  sweepLegalHoldReviewReminders,
  sweepTaskDeadlineReminders,
} from '@visastack/services';
import { createAiReadingPorts } from './ai-reading-ports';
import { resolveBaseUrl } from './base-url';
import { dispatchGithubIntake } from './github-intake';
import { runKmsSelfTest } from './kms-self-test';
import { incompleteProviderMessage } from './payment-providers';
import { withoutPaymentSecrets } from './payment-secrets';
import {
  createContentLimitsChecker,
  createDocumentConverter,
  createEmailPort,
  createKeyManagementPort,
  createMalwareScanner,
  createObservabilityPort,
  createStorage,
  incompletePaymentSettings,
  paymentPorts,
} from './providers';
import { reportServerError } from './server-error';

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
    const scanner = createMalwareScanner(storage);
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
    reportServerError('triggerErasureWorker', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof runErasureWorker>[0];
    const storage = createStorage(handle);
    return await runErasureWorker(handle, storage, options);
  } catch (error) {
    reportServerError('triggerErasureWorker', error, { step: 'worker pass failed' });
    return { processed: 0, blocked: 0, failed: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Runs the account export worker (PRV-04, master directive Part 7 §14
 * "Large export") on its own short-lived pooled connection -- same
 * rationale as `triggerErasureWorker` above. A missing key management port
 * is not treated as a configuration error here (unlike the missing-database
 * case): it is caught per-job, inside `runAccountExportWorker` itself, and
 * recorded on that job's own `lastError` so it shows up wherever a future
 * admin surface lists jobs needing attention, exactly like a permanently
 * FAILED erasure job does today.
 */
export async function triggerAccountExportWorker(
  options: { readonly limit?: number } = {},
): Promise<AccountExportWorkerResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerAccountExportWorker] database not configured');
    return { ready: 0, failed: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerAccountExportWorker', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof runAccountExportWorker>[0];
    const ports = {
      blobStore: createStorage(handle),
      keyManagement: createKeyManagementPort(),
      bundler: new JszipBundler(),
    };
    return await runAccountExportWorker(handle, ports, options);
  } catch (error) {
    reportServerError('triggerAccountExportWorker', error, { step: 'worker pass failed' });
    return { ready: 0, failed: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Purges account export artifacts past their 24h (default) expiry, and any
 * whose owning account is already gone -- see `accountExportJobs.accountId`'s
 * own schema comment for why the latter can't wait for the normal clock.
 * Same short-lived-pooled-connection rationale as every worker above.
 */
export async function triggerAccountExportExpirySweep(
  options: { readonly limit?: number } = {},
): Promise<AccountExportExpirySweepResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerAccountExportExpirySweep] database not configured');
    return { expired: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerAccountExportExpirySweep', error, {
      step: 'idle pool connection error',
    });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepExpiredAccountExportArtifacts>[0];
    const storage = createStorage(handle);
    return await sweepExpiredAccountExportArtifacts(handle, storage, options.limit);
  } catch (error) {
    reportServerError('triggerAccountExportExpirySweep', error, { step: 'sweep pass failed' });
    return { expired: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Runs the notification outbox worker (NTF-02/§3, Part 5) on its own
 * short-lived pooled connection -- same rationale as the workers above.
 * "Targets: event enqueue <=60 seconds" is met by calling this right after
 * an event-enqueueing action via `after()`; the periodic
 * `/api/jobs/process-notifications` cron is the durability backstop for
 * whatever that misses (a crashed invocation, a retry whose backoff has
 * since elapsed).
 */
export async function triggerNotificationWorker(
  options: {
    readonly limit?: number;
    readonly timeBudgetMs?: number;
    /** Only the messages about this one record, sent while the person waits. */
    readonly resourceId?: string;
    /** Asked first, on the same connection; the pass runs only when it answers true. */
    readonly gate?: (db: Parameters<typeof runNotificationWorker>[0]) => Promise<boolean>;
  } = {},
): Promise<NotificationWorkerResult & { readonly unavailable?: true }> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerNotificationWorker] database not configured');
    return { sent: 0, retrying: 0, failed: 0, unavailable: true };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerNotificationWorker', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof runNotificationWorker>[0];
    const { gate, ...workerOptions } = options;
    if (gate && !(await gate(handle))) return { sent: 0, retrying: 0, failed: 0 };
    const encryption = createKeyManagementPort();
    return await runNotificationWorker(handle, createEmailPort(), resolveBaseUrl(), {
      timeBudgetMs: 35_000,
      ...(encryption ? { encryption } : {}),
      ...workerOptions,
    });
  } catch (error) {
    reportServerError('triggerNotificationWorker', error, { step: 'worker pass failed' });
    return { sent: 0, retrying: 0, failed: 0, unavailable: true };
  } finally {
    await pool.end();
  }
}

/**
 * A short pass over waiting emails, at most once a minute across the whole platform (a shared
 * counter in the database), started after ordinary signed-in requests. The hosting plan runs the
 * sending job once a day, so without this a retry, or an email from a flow with no instant send,
 * could wait up to a day. Never throws: a failed pass is reported and the next request tries again.
 */
export async function drainWaitingEmails(): Promise<void> {
  // One connection for both the turn check and the pass. A failed turn check counts as "not now".
  await triggerNotificationWorker({
    limit: 10,
    timeBudgetMs: 10_000,
    gate: async (db) => {
      try {
        const turn = await checkRateLimit(
          db as unknown as Parameters<typeof checkRateLimit>[0],
          { subjectId: 'platform', action: 'notifications.backstop', label: 'email' },
          RATE_LIMITS.NOTIFICATION_BACKSTOP,
        );
        return turn.allowed;
      } catch (error) {
        reportServerError('drainWaitingEmails', error, { step: 'turn check failed' });
        return false;
      }
    },
  });
}

/**
 * Runs both NTF-04 date-threshold sweeps (task deadlines, document/
 * verification expiry) on their own short-lived pooled connection -- same
 * rationale as the workers above. "Date checks at least hourly": this is
 * purely periodic (there is no single domain-change moment to `after()`
 * off of, unlike the event-driven notifications), so `/api/jobs/
 * process-notification-sweeps`' cron is this trigger's only source, not a
 * backstop for an `after()` primary path.
 */
export async function triggerNotificationSweeps(
  options: { readonly limit?: number } = {},
): Promise<{
  readonly tasks: SweepResult;
  readonly expiry: ExpirySweepResult;
  readonly unavailable?: true;
}> {
  const connectionString = resolveDatabaseUrl(process.env);
  const empty: SweepResult = { checked: 0, enqueued: 0 };
  const emptyExpiry: ExpirySweepResult = { checked: 0, enqueued: 0, missionsDirtied: 0 };
  if (!connectionString) {
    console.error('[triggerNotificationSweeps] database not configured');
    return { tasks: empty, expiry: emptyExpiry, unavailable: true };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerNotificationSweeps', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepTaskDeadlineReminders>[0];
    const now = new Date();
    const tasks = await sweepTaskDeadlineReminders(handle, now, options);
    const expiry = await sweepExpiryReminders(handle, now, options);
    return { tasks, expiry };
  } catch (error) {
    reportServerError('triggerNotificationSweeps', error, { step: 'sweep pass failed' });
    return { tasks: empty, expiry: emptyExpiry, unavailable: true };
  } finally {
    await pool.end();
  }
}

/**
 * Applies a delivery/bounce/complaint webhook event (NTF-03, Part 5 §5) on
 * its own short-lived pooled connection -- same rationale as the workers
 * above. Called from `/api/webhooks/resend` only after that route has
 * already verified the request's Svix signature; this function performs no
 * verification of its own and trusts the caller entirely.
 */
export async function triggerEmailDeliveryWebhook(input: {
  readonly providerMessageId: string;
  readonly outcome: 'delivered' | 'bounced' | 'complained' | 'failed';
}): Promise<{ readonly applied: boolean }> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerEmailDeliveryWebhook] database not configured');
    return { applied: false };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerEmailDeliveryWebhook', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof applyEmailDeliveryEvent>[0];
    return await applyEmailDeliveryEvent(handle, input);
  } catch (error) {
    reportServerError('triggerEmailDeliveryWebhook', error, { step: 'apply failed' });
    return { applied: false };
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
    reportServerError('triggerAccountDeletionSweep', error, { step: 'idle pool connection error' });
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
    reportServerError('triggerAccountDeletionSweep', error, { step: 'sweep failed' });
  } finally {
    await pool.end();
  }
  return { executed };
}

/**
 * The loop over due downgrades, kept apart from `triggerDowngradeSweep` so it can be tested
 * without a database pool. Each downgrade is tried on its own: a refusal or an error on one is
 * reported and counted, and the rest still run (S29 round 3).
 */
export async function executeDueDowngrades(
  handle: Parameters<typeof listDueDowngrades>[0],
  deps: {
    readonly list?: typeof listDueDowngrades;
    readonly execute?: typeof executeScheduledDowngrade;
    readonly report?: typeof reportServerError;
  } = {},
): Promise<{ readonly executed: number; readonly errors: number }> {
  const list = deps.list ?? listDueDowngrades;
  const execute = deps.execute ?? executeScheduledDowngrade;
  const report = deps.report ?? reportServerError;
  let executed = 0;
  let errors = 0;
  for (const downgrade of await list(handle)) {
    try {
      const result = await execute(handle, { downgradeId: downgrade.id });
      if (isOk(result)) {
        executed++;
        continue;
      }
      errors++;
      // S29 round 2: a refused downgrade (for example its plan was retired) is reported through
      // the one error channel, with its code and id, never only printed.
      report(
        'triggerDowngradeSweep',
        new Error(`scheduled downgrade not executed: ${result.error.code}`),
        {
          step: 'execute',
          downgradeId: downgrade.id,
          code: result.error.code,
        },
      );
    } catch (error) {
      errors++;
      report('triggerDowngradeSweep', error, { step: 'execute', downgradeId: downgrade.id });
    }
  }
  return { executed, errors };
}

/**
 * Executes every scheduled downgrade whose effective date has arrived
 * (Commercial V1 COM-02, Part 5 §7 "Downgrade"). This is the only thing
 * that ever calls `executeScheduledDowngrade` -- without it, a downgrade
 * opened via `scheduleDowngrade` would sit at PENDING forever, its
 * organization never actually moved onto the lower plan it warned about.
 * Errors on one organization are logged and skipped, never allowed to
 * abort the rest of the sweep -- same rationale as
 * `triggerAccountDeletionSweep`.
 */
export async function triggerDowngradeSweep(): Promise<{
  readonly executed: number;
  readonly errors: number;
}> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerDowngradeSweep] database not configured');
    return { executed: 0, errors: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerDowngradeSweep', error, { step: 'idle pool connection error' });
  });
  let outcome = { executed: 0, errors: 0 };
  try {
    const handle = db as unknown as Parameters<typeof listDueDowngrades>[0];
    outcome = await executeDueDowngrades(handle);
  } catch (error) {
    reportServerError('triggerDowngradeSweep', error, { step: 'sweep failed' });
    outcome = { ...outcome, errors: outcome.errors + 1 };
  } finally {
    await pool.end();
  }
  return outcome;
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
    reportServerError('triggerAbandonedUploadSweep', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepAbandonedUploads>[0];
    const storage = createStorage(handle);
    return await sweepAbandonedUploads(handle, storage, options.limit, createObservabilityPort());
  } catch (error) {
    reportServerError('triggerAbandonedUploadSweep', error, { step: 'sweep failed' });
    return { checked: 0, cleaned: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Purges abandoned organization-invitation metadata (directive Part 7 §11:
 * "abandoned invite metadata: 30d") on its own short-lived pooled
 * connection, same rationale as the sweeps above.
 */
export async function triggerAbandonedOrganizationInvitationSweep(
  options: { readonly limit?: number } = {},
): Promise<AbandonedOrganizationInvitationSweepResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerAbandonedOrganizationInvitationSweep] database not configured');
    return { checked: 0, deleted: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerAbandonedOrganizationInvitationSweep', error, {
      step: 'idle pool connection error',
    });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepAbandonedOrganizationInvitations>[0];
    return await sweepAbandonedOrganizationInvitations(handle, options.limit);
  } catch (error) {
    reportServerError('triggerAbandonedOrganizationInvitationSweep', error, {
      step: 'sweep failed',
    });
    return { checked: 0, deleted: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Purges abandoned client-invitation metadata (directive Part 7 §11:
 * "abandoned invite metadata: 30d") on its own short-lived pooled
 * connection, same rationale as the sweeps above.
 */
export async function triggerAbandonedClientInvitationSweep(
  options: { readonly limit?: number } = {},
): Promise<AbandonedClientInvitationSweepResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerAbandonedClientInvitationSweep] database not configured');
    return { checked: 0, deleted: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerAbandonedClientInvitationSweep', error, {
      step: 'idle pool connection error',
    });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepAbandonedClientInvitations>[0];
    return await sweepAbandonedClientInvitations(handle, options.limit);
  } catch (error) {
    reportServerError('triggerAbandonedClientInvitationSweep', error, { step: 'sweep failed' });
    return { checked: 0, deleted: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Sends the closed-case retention notice (directive Part 7 §11: "closed
 * case: initial proposed 12m with 30d notice") on its own short-lived
 * pooled connection, same rationale as the sweeps above. Notice only -- see
 * `triggerCaseRetentionPurgeSweep` below for the actual deletion, 30 days
 * later.
 */
export async function triggerCaseRetentionNoticeSweep(
  options: { readonly limit?: number } = {},
): Promise<CaseRetentionNoticeSweepResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerCaseRetentionNoticeSweep] database not configured');
    return { checked: 0, notified: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerCaseRetentionNoticeSweep', error, {
      step: 'idle pool connection error',
    });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepCaseRetentionNotices>[0];
    return await sweepCaseRetentionNotices(handle, options.limit);
  } catch (error) {
    reportServerError('triggerCaseRetentionNoticeSweep', error, { step: 'sweep failed' });
    return { checked: 0, notified: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Pushes the legal-hold review reminder (directive Part 7 §13: "any
 * scheduled reminder when a hold becomes due") on its own short-lived
 * pooled connection -- same rationale as every other trigger function here.
 * Unlike the one-time retention/inactivity notices above, this re-fires
 * for as long as a hold stays overdue (see `sweepLegalHoldReviewReminders`'s
 * own doc comment), so it is safe, and expected, to call on every scheduled
 * sweep run indefinitely.
 */
export async function triggerLegalHoldReviewReminderSweep(
  options: { readonly limit?: number } = {},
): Promise<LegalHoldReminderSweepResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerLegalHoldReviewReminderSweep] database not configured');
    return { checked: 0, notified: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerLegalHoldReviewReminderSweep', error, {
      step: 'idle pool connection error',
    });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepLegalHoldReviewReminders>[0];
    return await sweepLegalHoldReviewReminders(handle, options.limit);
  } catch (error) {
    reportServerError('triggerLegalHoldReviewReminderSweep', error, { step: 'sweep failed' });
    return { checked: 0, notified: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Purges a closed case's records 30 days after its retention notice
 * (directive Part 7 §11). Off by default -- `sweepCaseRetentionPurge` itself
 * refuses to delete anything unless `CASE_RETENTION_PURGE_ENABLED` is
 * literally "true" on this deployment, so this route/job existing does not
 * by itself turn on real deletion.
 */
export async function triggerCaseRetentionPurgeSweep(
  options: { readonly limit?: number } = {},
): Promise<CaseRetentionPurgeSweepResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerCaseRetentionPurgeSweep] database not configured');
    return { enabled: false, checked: 0, purged: 0, skippedForHold: 0, skippedForComplaint: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerCaseRetentionPurgeSweep', error, {
      step: 'idle pool connection error',
    });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepCaseRetentionPurge>[0];
    return await sweepCaseRetentionPurge(handle, options.limit);
  } catch (error) {
    reportServerError('triggerCaseRetentionPurgeSweep', error, { step: 'sweep failed' });
    return { enabled: false, checked: 0, purged: 0, skippedForHold: 0, skippedForComplaint: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Sends the inactive-account retention notice (directive Part 7 §11:
 * "wallet original: until deletion/inactive-account policy") once an
 * account has had no authenticated activity for the configured threshold.
 * Notice only -- see `triggerInactiveAccountDeletionSweep` for the actual
 * follow-up, 30 days later.
 */
export async function triggerInactiveAccountNoticeSweep(
  options: { readonly limit?: number } = {},
): Promise<InactiveAccountNoticeSweepResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerInactiveAccountNoticeSweep] database not configured');
    return { checked: 0, notified: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerInactiveAccountNoticeSweep', error, {
      step: 'idle pool connection error',
    });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepInactiveAccountNotices>[0];
    return await sweepInactiveAccountNotices(handle, options.limit);
  } catch (error) {
    reportServerError('triggerInactiveAccountNoticeSweep', error, { step: 'sweep failed' });
    return { checked: 0, notified: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Opens a cancellable, system-initiated deletion request 30 days after the
 * inactive-account notice above, if still genuinely inactive. Off by
 * default -- `sweepInactiveAccountDeletionRequests` itself refuses to
 * create anything unless `INACTIVE_ACCOUNT_DELETION_ENABLED` is literally
 * "true" on this deployment. The request this creates is executed later by
 * the existing `process-deletions` job, unchanged.
 */
export async function triggerInactiveAccountDeletionSweep(
  options: { readonly limit?: number } = {},
): Promise<InactiveAccountDeletionSweepResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerInactiveAccountDeletionSweep] database not configured');
    return { enabled: false, checked: 0, requested: 0, skipped: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerInactiveAccountDeletionSweep', error, {
      step: 'idle pool connection error',
    });
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepInactiveAccountDeletionRequests>[0];
    return await sweepInactiveAccountDeletionRequests(handle, options.limit);
  } catch (error) {
    reportServerError('triggerInactiveAccountDeletionSweep', error, { step: 'sweep failed' });
    return { enabled: false, checked: 0, requested: 0, skipped: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Deletes rate-limit counters whose window ended more than 24 hours ago
 * (Part 9 SEC-02). Counters are only ever read for their own window, and
 * nothing else removed them, so without this the table would grow with every
 * new limit. Same short-lived-pooled-connection rationale as the sweeps above.
 */
export async function triggerRateLimitPrune(): Promise<{ readonly pruned: number }> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerRateLimitPrune] database not configured');
    return { pruned: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerRateLimitPrune', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof pruneExpiredRateLimitBuckets>[0];
    const pruned = await pruneExpiredRateLimitBuckets(handle);
    // The same daily tidy-up removes expired AI app sign-in tokens and app registrations unused
    // for 30 days (ADR 0021); both are no-ops until their tables exist.
    await deleteExpiredAiTokens(handle);
    await deleteStaleAiClients(handle);
    return { pruned };
  } catch (error) {
    reportServerError('triggerRateLimitPrune', error, { step: 'prune failed' });
    return { pruned: 0 };
  } finally {
    await pool.end();
  }
}

/**
 * Moves every stored data key from the local key to the key service (S26). Run on the owner's
 * word, not on a schedule: see docs/operations/key-management.md. Returns counts only.
 */
export async function triggerDataKeyRewrap(
  scope: SystemScope<'rewrap-data-keys'>,
): Promise<DataKeyRewrapSummary | { readonly error: string }> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) return { error: 'not_configured' };
  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerDataKeyRewrap', error, { step: 'idle pool connection error' });
  });
  try {
    const port = createKeyManagementPort();
    if (!port) return { error: 'not_configured' };
    // Never replace a wrapping unless the key service has just proved it can wrap and open.
    if (!(await runKmsSelfTest())) return { error: 'key_service_check_failed' };
    const handle = db as unknown as Parameters<typeof rewrapDataKeys>[0];
    return await rewrapDataKeys(handle, scope, port);
  } catch (error) {
    reportServerError('triggerDataKeyRewrap', error, { step: 'rewrap failed' });
    return { error: 'failed' };
  } finally {
    await pool.end();
  }
}

/**
 * The daily payment check's time budget (the route allows 60 seconds): payments may start gateway
 * calls for 25 seconds, then refunds for 15 of their own, so a slow payment check can never leave
 * refunds without time (S18).
 */
export const PAYMENT_CHECK_BUDGET_MS = 25_000;
export const REFUND_CHECK_BUDGET_MS = 15_000;

/**
 * Asks the payment gateway about online payments that have not been confirmed yet (S11, ADR
 * 0020): payments the payer left open, and ones closed as expired that may still have succeeded.
 * Asks nothing (and reports `configured: false`) while no payment provider is configured, but
 * still counts open payments and sent refunds no provider here can be asked about. Returns counts
 * only.
 *
 * A provider the owner chose but left with incomplete settings is off. It is reported here (its
 * name and the settings it lacks, never a value) and named in `incompleteProviders`, which the
 * route answers as a failed run; the other providers are still asked (S19 step 0 round 2).
 */
export async function triggerPaymentReconciliation(
  scope: SystemScope<'process-payment-reconciliation'>,
): Promise<
  | (ReconciliationSummary & {
      readonly refunds: RefundCheckSummary | { readonly error: string };
      readonly incompleteProviders: readonly string[];
    })
  | { readonly error: string }
> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) return { error: 'not_configured' };
  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerPaymentReconciliation', error, {
      step: 'idle pool connection error',
    });
  });
  try {
    // S19 step 0: every configured provider, each asked only about its own payments and refunds.
    const incomplete = incompletePaymentSettings();
    for (const provider of incomplete) {
      reportServerError(
        'triggerPaymentReconciliation',
        new Error(incompleteProviderMessage(provider)),
        {
          step: 'provider settings incomplete',
          provider: provider.key,
        },
      );
    }
    const payments = paymentPorts();
    const handle = db as unknown as Parameters<typeof reconcilePaymentAttempts>[0];
    // The route may run for 60 seconds: payments get 25 seconds to start gateway calls, then
    // refunds 15 of their own; whatever is left is counted and asked about next run.
    const checked = await reconcilePaymentAttempts(handle, scope, payments, {
      deadline: Date.now() + PAYMENT_CHECK_BUDGET_MS,
    });
    // S18: refunds the gateway has taken are confirmed in the same daily run. A refund check that
    // fails is reported on its own and never hides the payment counts.
    let refunds: RefundCheckSummary | { readonly error: string };
    try {
      refunds = await reconcileRefunds(handle, scope, paymentPorts({ refundsOnly: true }), {
        deadline: Date.now() + REFUND_CHECK_BUDGET_MS,
      });
      if (refunds.checked === 0 && refunds.leftForLater > 0) {
        reportServerError(
          'triggerPaymentReconciliation',
          new Error('the refund check ran out of time before asking about any sent refund'),
          { step: 'refund check out of time', left: String(refunds.leftForLater) },
        );
      }
    } catch (error) {
      reportServerError('triggerPaymentReconciliation', withoutPaymentSecrets(error), {
        step: 'refund check failed',
      });
      refunds = { error: 'failed' };
    }
    return { ...checked, refunds, incompleteProviders: incomplete.map((provider) => provider.key) };
  } catch (error) {
    reportServerError('triggerPaymentReconciliation', withoutPaymentSecrets(error), {
      step: 'reconciliation failed',
    });
    return { error: 'failed' };
  } finally {
    await pool.end();
  }
}

/**
 * The daily billing run (S17, ADR 0020 Phase 2): creates each agency's invoice for the plan period
 * running now, queues invoice reminders, and, only when the owner has switched it on in Billing
 * Rules, moves agencies with an unpaid invoice to Grace and then Suspended. On its own short-lived
 * pooled connection, like the workers above. Counts only.
 */
export async function triggerBillingCycle(
  scope: SystemScope<'process-billing-cycle'>,
): Promise<BillingCycleSummary | { readonly error: string }> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) return { error: 'not_configured' };
  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    reportServerError('triggerBillingCycle', error, { step: 'idle pool connection error' });
  });
  try {
    const handle = db as unknown as Parameters<typeof runBillingCycle>[0];
    const summary = await runBillingCycle(handle, scope);
    if (summary.failed > 0) {
      reportServerError('triggerBillingCycle', new Error('billing run had failures'), {
        step: 'billing run',
        failed: String(summary.failed),
      });
    }
    return summary;
  } catch (error) {
    reportServerError('triggerBillingCycle', error, { step: 'billing run failed' });
    return { error: 'failed' };
  } finally {
    await pool.end();
  }
}
