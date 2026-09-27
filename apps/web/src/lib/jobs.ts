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
  type CaseRetentionNoticeSweepResult,
  type CaseRetentionPurgeSweepResult,
  type ErasureWorkerResult,
  type ExpirySweepResult,
  type InactiveAccountDeletionSweepResult,
  type InactiveAccountNoticeSweepResult,
  type IntakeWorkerResult,
  type LegalHoldReminderSweepResult,
  type NotificationWorkerResult,
  type SweepResult,
  applyEmailDeliveryEvent,
  executeAccountDeletion,
  executeScheduledDowngrade,
  listDueDeletions,
  listDueDowngrades,
  runAccountExportWorker,
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
import { resolveBaseUrl } from './base-url';
import {
  createContentLimitsChecker,
  createDocumentConverter,
  createEmailPort,
  createKeyManagementPort,
  createMalwareScanner,
  createObservabilityPort,
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
    return await runIntakeWorker(handle, scanner, extractor, contentLimits, {
      ...options,
      observability: createObservabilityPort(),
    });
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
    console.error('[triggerAccountExportWorker] idle pool connection error', error);
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
    console.error('[triggerAccountExportWorker] worker pass failed', error);
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
    console.error('[triggerAccountExportExpirySweep] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepExpiredAccountExportArtifacts>[0];
    const storage = createStorage(handle);
    return await sweepExpiredAccountExportArtifacts(handle, storage, options.limit);
  } catch (error) {
    console.error('[triggerAccountExportExpirySweep] sweep pass failed', error);
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
  options: { readonly limit?: number } = {},
): Promise<NotificationWorkerResult> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerNotificationWorker] database not configured');
    return { sent: 0, retrying: 0, failed: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    console.error('[triggerNotificationWorker] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof runNotificationWorker>[0];
    return await runNotificationWorker(handle, createEmailPort(), resolveBaseUrl(), options);
  } catch (error) {
    console.error('[triggerNotificationWorker] worker pass failed', error);
    return { sent: 0, retrying: 0, failed: 0 };
  } finally {
    await pool.end();
  }
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
): Promise<{ readonly tasks: SweepResult; readonly expiry: ExpirySweepResult }> {
  const connectionString = resolveDatabaseUrl(process.env);
  const empty: SweepResult = { checked: 0, enqueued: 0 };
  const emptyExpiry: ExpirySweepResult = { checked: 0, enqueued: 0, missionsDirtied: 0 };
  if (!connectionString) {
    console.error('[triggerNotificationSweeps] database not configured');
    return { tasks: empty, expiry: emptyExpiry };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    console.error('[triggerNotificationSweeps] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepTaskDeadlineReminders>[0];
    const now = new Date();
    const tasks = await sweepTaskDeadlineReminders(handle, now, options);
    const expiry = await sweepExpiryReminders(handle, now, options);
    return { tasks, expiry };
  } catch (error) {
    console.error('[triggerNotificationSweeps] sweep pass failed', error);
    return { tasks: empty, expiry: emptyExpiry };
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
  readonly outcome: 'delivered' | 'bounced' | 'complained';
}): Promise<{ readonly applied: boolean }> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerEmailDeliveryWebhook] database not configured');
    return { applied: false };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    console.error('[triggerEmailDeliveryWebhook] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof applyEmailDeliveryEvent>[0];
    return await applyEmailDeliveryEvent(handle, input);
  } catch (error) {
    console.error('[triggerEmailDeliveryWebhook] apply failed', error);
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
 * Executes every scheduled downgrade whose effective date has arrived
 * (Commercial V1 COM-02, Part 5 §7 "Downgrade"). This is the only thing
 * that ever calls `executeScheduledDowngrade` -- without it, a downgrade
 * opened via `scheduleDowngrade` would sit at PENDING forever, its
 * organization never actually moved onto the lower plan it warned about.
 * Errors on one organization are logged and skipped, never allowed to
 * abort the rest of the sweep -- same rationale as
 * `triggerAccountDeletionSweep`.
 */
export async function triggerDowngradeSweep(): Promise<{ readonly executed: number }> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    console.error('[triggerDowngradeSweep] database not configured');
    return { executed: 0 };
  }

  const { db, pool } = createPooledDb(connectionString);
  pool.on('error', (error) => {
    console.error('[triggerDowngradeSweep] idle pool connection error', error);
  });
  let executed = 0;
  try {
    const handle = db as unknown as Parameters<typeof listDueDowngrades>[0];
    const due = await listDueDowngrades(handle);
    for (const downgrade of due) {
      const result = await executeScheduledDowngrade(handle, { downgradeId: downgrade.id });
      if (isOk(result)) executed++;
      else console.error('[triggerDowngradeSweep] execution failed', result.error);
    }
  } catch (error) {
    console.error('[triggerDowngradeSweep] sweep failed', error);
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
    return await sweepAbandonedUploads(handle, storage, options.limit, createObservabilityPort());
  } catch (error) {
    console.error('[triggerAbandonedUploadSweep] sweep failed', error);
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
    console.error(
      '[triggerAbandonedOrganizationInvitationSweep] idle pool connection error',
      error,
    );
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepAbandonedOrganizationInvitations>[0];
    return await sweepAbandonedOrganizationInvitations(handle, options.limit);
  } catch (error) {
    console.error('[triggerAbandonedOrganizationInvitationSweep] sweep failed', error);
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
    console.error('[triggerAbandonedClientInvitationSweep] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepAbandonedClientInvitations>[0];
    return await sweepAbandonedClientInvitations(handle, options.limit);
  } catch (error) {
    console.error('[triggerAbandonedClientInvitationSweep] sweep failed', error);
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
    console.error('[triggerCaseRetentionNoticeSweep] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepCaseRetentionNotices>[0];
    return await sweepCaseRetentionNotices(handle, options.limit);
  } catch (error) {
    console.error('[triggerCaseRetentionNoticeSweep] sweep failed', error);
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
    console.error('[triggerLegalHoldReviewReminderSweep] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepLegalHoldReviewReminders>[0];
    return await sweepLegalHoldReviewReminders(handle, options.limit);
  } catch (error) {
    console.error('[triggerLegalHoldReviewReminderSweep] sweep failed', error);
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
    console.error('[triggerCaseRetentionPurgeSweep] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepCaseRetentionPurge>[0];
    return await sweepCaseRetentionPurge(handle, options.limit);
  } catch (error) {
    console.error('[triggerCaseRetentionPurgeSweep] sweep failed', error);
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
    console.error('[triggerInactiveAccountNoticeSweep] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepInactiveAccountNotices>[0];
    return await sweepInactiveAccountNotices(handle, options.limit);
  } catch (error) {
    console.error('[triggerInactiveAccountNoticeSweep] sweep failed', error);
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
    console.error('[triggerInactiveAccountDeletionSweep] idle pool connection error', error);
  });
  try {
    const handle = db as unknown as Parameters<typeof sweepInactiveAccountDeletionRequests>[0];
    return await sweepInactiveAccountDeletionRequests(handle, options.limit);
  } catch (error) {
    console.error('[triggerInactiveAccountDeletionSweep] sweep failed', error);
    return { enabled: false, checked: 0, requested: 0, skipped: 0 };
  } finally {
    await pool.end();
  }
}
