import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { runAutomaticReading } from './run';

/**
 * Automatic AI reading of files that finished intake (S5, ADR 0019).
 *
 * The primary trigger is right after an upload finishes its checks (`triggerIntakeAndReading` in
 * `./run`); this route is the durability backstop for whatever that does not catch: a crashed
 * invocation, a reading queued while the private document worker ran intake, or a retry whose
 * delay has passed. Configured as a Vercel Cron target (see `apps/web/vercel.json`); Vercel signs
 * cron-triggered requests with `Authorization: Bearer $CRON_SECRET`, which this route verifies.
 * Fails closed (503) if the secret is not configured, and never runs unauthenticated.
 *
 * The worker reads each file as its owner and only with that owner's consent, checked when the job
 * runs. A reading that cannot proceed (consent withdrawn, AI switched off, a spend limit) is
 * recorded on the job and shown to the person; it is not an outage and does not fail this route.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Bounded: one invocation reads a few files and stops with time to spare.
const READINGS_PER_SWEEP = 20;
const TIME_BUDGET_MS = 40_000;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;

  const result = await runAutomaticReading({
    limit: READINGS_PER_SWEEP,
    timeBudgetMs: TIME_BUDGET_MS,
  });
  if (result.unavailable) return Response.json({ status: 'unavailable' }, { status: 503 });
  return Response.json({
    processed: result.processed,
    stopped: result.stopped,
    failed: result.failed,
  });
}
