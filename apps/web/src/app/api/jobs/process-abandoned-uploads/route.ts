import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerAbandonedUploadSweep } from '../../../../lib/jobs';

/**
 * Cleans up upload reservations abandoned mid-request (directive Part 3 §3:
 * "delete abandoned objects/reservations after 24 hours") — a request
 * killed between the blob write and `finalizeUpload`/`failUpload` (a
 * serverless timeout, OOM, or container recycle) leaves a `RESERVED`
 * `uploadIntents` row and possibly orphaned bytes under its own object key
 * that no in-request try/catch can cover. Configured as a Vercel Cron
 * target (see `apps/web/vercel.json`); Vercel signs cron-triggered requests
 * with `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set on
 * the project, which this route verifies. Fails closed (503) if the secret
 * isn't configured — never runs unauthenticated.
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

  let totalChecked = 0;
  let totalCleaned = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerAbandonedUploadSweep({ limit: BATCH_SIZE });
    totalChecked += result.checked;
    totalCleaned += result.cleaned;
    if (result.checked < BATCH_SIZE) break; // caught up
  }

  return Response.json({ checked: totalChecked, cleaned: totalCleaned });
}
