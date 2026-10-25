import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerRateLimitPrune } from '../../../../lib/jobs';

/**
 * Removes rate-limit counters whose window ended more than 24 hours ago
 * (Part 9 SEC-02). The counters behind every anti-automation limit
 * (`rate_limit_buckets`) were only ever deleted when an account was erased, so
 * each additional limit would otherwise grow the table for good. Configured as
 * a Vercel Cron target (see `apps/web/vercel.json`); Vercel signs
 * cron-triggered requests with `Authorization: Bearer $CRON_SECRET` when
 * `CRON_SECRET` is set on the project, which this route verifies. Fails closed
 * (503) if the secret isn't configured -- never runs unauthenticated.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;

  return Response.json(await triggerRateLimitPrune());
}
