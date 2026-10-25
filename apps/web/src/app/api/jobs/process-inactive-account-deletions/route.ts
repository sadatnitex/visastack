import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerInactiveAccountDeletionSweep } from '../../../../lib/jobs';

/**
 * Opens a cancellable, system-initiated deletion request (directive Part 7
 * §11: "wallet original: until deletion/inactive-account policy") 30 days
 * after the notice sent by `process-inactive-account-notices`, if the
 * account is still genuinely inactive. This creates a normal
 * `accountDeletionRequests` row -- the same "pending deletion, cancel here"
 * UI the privacy page already renders for a self-requested one applies
 * unchanged, and the existing `process-deletions` job (unchanged) is what
 * actually executes it after its own grace window. Off by default --
 * `sweepInactiveAccountDeletionRequests` itself refuses to create anything
 * unless `INACTIVE_ACCOUNT_DELETION_ENABLED` is literally "true" on this
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
  let requested = 0;
  let skipped = 0;
  let enabled = false;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerInactiveAccountDeletionSweep({ limit: BATCH_SIZE });
    enabled = result.enabled;
    checked += result.checked;
    requested += result.requested;
    skipped += result.skipped;
    if (!result.enabled || result.checked < BATCH_SIZE) break; // disabled, or caught up
  }

  return Response.json({ enabled, checked, requested, skipped });
}
