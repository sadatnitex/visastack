import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerCaseRetentionPurgeSweep } from '../../../../lib/jobs';

/**
 * Purges a closed case's records (directive Part 7 §11: "closed case:
 * initial proposed 12m with 30d notice") once 30 days have passed since the
 * notice sent by `process-case-retention-notices`. Deletes real, irreversible
 * data -- off by default: `sweepCaseRetentionPurge` itself refuses to delete
 * anything unless `CASE_RETENTION_PURGE_ENABLED` is literally "true" on this
 * deployment. Configured as a Vercel Cron target (see `apps/web/vercel.json`);
 * Vercel signs cron-triggered requests with `Authorization: Bearer
 * $CRON_SECRET` when `CRON_SECRET` is set on the project, which this route
 * verifies. Fails closed (503) if the secret isn't configured -- never runs
 * unauthenticated.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Bounded: drains up to this many batches per sweep so one invocation can't
// run unbounded even if the backlog is unexpectedly large.
const MAX_BATCHES_PER_SWEEP = 20;
const BATCH_SIZE = 50;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;

  let checked = 0;
  let purged = 0;
  let skippedForHold = 0;
  let skippedForComplaint = 0;
  let enabled = false;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerCaseRetentionPurgeSweep({ limit: BATCH_SIZE });
    enabled = result.enabled;
    checked += result.checked;
    purged += result.purged;
    skippedForHold += result.skippedForHold;
    skippedForComplaint += result.skippedForComplaint;
    if (!result.enabled || result.checked < BATCH_SIZE) break; // disabled, or caught up
  }

  return Response.json({ enabled, checked, purged, skippedForHold, skippedForComplaint });
}
