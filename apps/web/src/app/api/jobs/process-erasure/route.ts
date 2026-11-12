import { systemPrincipal } from '@visastack/services';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerErasureWorker } from '../../../../lib/jobs';
import { runGuestRetentionPurge } from '../../../../lib/lifecycle-jobs/guest-purge';
import { runHeldJobRequeue } from '../../../../lib/lifecycle-jobs/hold-requeue';
import { runRecentlyDeletedPurge } from '../../../../lib/lifecycle-jobs/purge';

/**
 * Periodic sweep for the erasure outbox (master directive §7 "PR 4").
 *
 * The primary trigger is `after()` right after `purgeExpiredDocumentsAction`
 * enqueues work — this route exists as the durability backstop for whatever
 * that doesn't catch: a crashed invocation, a job left BLOCKED_BY_HOLD after
 * its hold was since released, or account-deletion jobs enqueued by
 * `/api/jobs/process-deletions` (which has no request to attach an `after()`
 * to). Configured as a Vercel Cron target (see `apps/web/vercel.json`);
 * Vercel signs cron-triggered requests with `Authorization: Bearer
 * $CRON_SECRET` when `CRON_SECRET` is set on the project, which this route
 * verifies. Fails closed (503) if the secret isn't configured — never runs
 * unauthenticated.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Bounded: drains up to this many batches per sweep so one invocation can't
// run unbounded even if the backlog is unexpectedly large.
const MAX_BATCHES_PER_SWEEP = 20;
const BATCH_SIZE = 5;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;

  const startedAt = Date.now();
  // Deleted duplicates whose 30 days are over start their verified removal first, so the worker
  // below destroys them in this same run (LC-C). A legal hold keeps them; nothing is queued then.
  const recentlyDeleted = await runRecentlyDeletedPurge(systemPrincipal('process-erasure'));

  let totalProcessed = 0;
  let totalBlocked = 0;
  let totalFailed = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerErasureWorker({ limit: BATCH_SIZE });
    totalProcessed += result.processed;
    totalBlocked += result.blocked;
    totalFailed += result.failed;
    if (result.processed + result.blocked + result.failed < BATCH_SIZE) break; // caught up
  }

  // Jobs parked by a hold that has since ended (a release normally re-queues them at once; this
  // catches a release that raced the worker, older parked jobs, and holds ended by a backup repair).
  // After the worker so its own work always runs first, and with a time budget (at least a few
  // seconds, at most until 40 seconds into the run) because this route stops at 60 seconds. What it
  // puts back is worked by the next run.
  const heldRequeue = await runHeldJobRequeue(systemPrincipal('process-erasure'), {
    stopAt: Math.max(startedAt + 40_000, Date.now() + 5_000),
  });

  // UMPE P9, after the erasure worker so its daily safety net always runs first: guest answers to
  // agency requests whose chosen period ended (never under a legal hold), and desk sessions that
  // can never be used again. Bounded by its own time budget.
  const guestRetention = await runGuestRetentionPurge(systemPrincipal('process-erasure'));

  return Response.json({
    processed: totalProcessed,
    blocked: totalBlocked,
    failed: totalFailed,
    heldRequeue,
    recentlyDeleted,
    guestRetention,
  });
}
