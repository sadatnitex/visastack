import { systemPrincipal } from '@visastack/services';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerAccountDeletionSweep, triggerErasureWorker } from '../../../../lib/jobs';
import { runTravellerPurge } from '../../../../lib/lifecycle-jobs/traveller-purge';

/**
 * Executes every account deletion request whose grace window has elapsed
 * (master directive §7 "PR 4"). `requestDeletionAction`/`cancelDeletionAction`
 * only open or cancel a request — this is the only thing that ever calls
 * `executeAccountDeletion`, so without it a due request would sit at PENDING
 * forever. Configured as a Vercel Cron target (see `apps/web/vercel.json`);
 * Vercel signs cron-triggered requests with `Authorization: Bearer
 * $CRON_SECRET` when `CRON_SECRET` is set on the project, which this route
 * verifies. Fails closed (503) if the secret isn't configured — never runs
 * unauthenticated.
 *
 * It also runs the traveller purge (LC-E): empty traveller records whose 30 days in Recently
 * Deleted are over are checked again and deleted (no new cron entry, PROGRAMME section 5.1).
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;

  const { executed } = await triggerAccountDeletionSweep();
  // Each executed deletion enqueues erasure jobs; run a bounded pass now
  // rather than waiting for the next independent erasure sweep.
  const erasure =
    executed > 0 ? await triggerErasureWorker() : { processed: 0, blocked: 0, failed: 0 };

  // Never throws; before migration 0113 it does nothing.
  const travellers = await runTravellerPurge(systemPrincipal('process-deletions'));

  return Response.json({ executed, erasure, travellers });
}
