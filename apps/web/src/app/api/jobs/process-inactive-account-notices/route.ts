import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerInactiveAccountNoticeSweep } from '../../../../lib/jobs';

/**
 * Sends the inactive-account retention notice (directive Part 7 §11:
 * "wallet original: until deletion/inactive-account policy") once an
 * account has had no authenticated activity for the configured threshold.
 * Notice only -- this never deletes or requests deletion of anything; see
 * `process-inactive-account-deletions` for that, 30 days later. Configured
 * as a Vercel Cron target (see `apps/web/vercel.json`); Vercel signs
 * cron-triggered requests with `Authorization: Bearer $CRON_SECRET` when
 * `CRON_SECRET` is set on the project, which this route verifies. Fails
 * closed (503) if the secret isn't configured -- never runs unauthenticated.
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
  let notified = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerInactiveAccountNoticeSweep({ limit: BATCH_SIZE });
    checked += result.checked;
    notified += result.notified;
    if (result.checked < BATCH_SIZE) break; // caught up
  }

  return Response.json({ checked, notified });
}
