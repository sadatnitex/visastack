import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerAccountExportWorker } from '../../../../lib/jobs';

/**
 * Periodic sweep for the account export outbox (PRV-04, master directive
 * Part 7 §14 "Large export"). The primary trigger is `after()` right after
 * a future export-request action enqueues work; this route is the
 * durability backstop for whatever that doesn't catch (a crashed
 * invocation, or a permanently FAILED job since retried). Same
 * cron-authentication shape as `process-erasure` - fails closed (503) if
 * `CRON_SECRET` isn't configured, never runs unauthenticated.
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

  let totalReady = 0;
  let totalFailed = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerAccountExportWorker({ limit: BATCH_SIZE });
    totalReady += result.ready;
    totalFailed += result.failed;
    if (result.ready + result.failed < BATCH_SIZE) break; // caught up
  }

  return Response.json({ ready: totalReady, failed: totalFailed });
}
