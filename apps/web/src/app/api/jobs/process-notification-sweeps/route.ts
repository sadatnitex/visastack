import { after } from 'next/server';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerNotificationSweeps, triggerNotificationWorker } from '../../../../lib/jobs';

/**
 * NTF-04 (Part 5 §4) date-threshold sweeps: task deadlines (7 days before;
 * 1 day before; overdue; bounded weekly overdue follow-up) and document/
 * verification expiry reminders (NTF-01's thresholds). Purely periodic --
 * there is no single domain-change moment to trigger off of the way the
 * event-driven notifications use `after()`, so this cron IS the only
 * trigger.
 *
 * Configured once daily, NOT hourly: this project is on Vercel's Hobby
 * plan, which rejects any cron schedule that would fire more than once a
 * day (a first attempt at `0 * * * *` here failed every deployment until
 * this was caught and fixed). The directive's own target is "date checks
 * at least hourly" -- this route does not meet that target on the current
 * plan, and there is no `after()`-style alternate trigger to fall back on
 * for this one, unlike `/api/jobs/process-notifications`. This is an
 * honest, documented gap (upgrading the Vercel plan, or hosting this
 * specific sweep on a platform that allows sub-daily cron, would close it),
 * not something silently downgraded without saying so; see
 * `requirements-ledger.md` NTF-04 and `known-issues.md`.
 *
 * Vercel signs cron-triggered requests with `Authorization: Bearer
 * $CRON_SECRET`, which this route verifies; fails closed (503) if the
 * secret isn't configured.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;

  const result = await triggerNotificationSweeps({ limit: 200 });
  if (result.unavailable) return Response.json({ status: 'unavailable' }, { status: 503 });
  // Emails this run queued go out now, not at the next day's sending run.
  after(() => triggerNotificationWorker().then(() => undefined));
  return Response.json(result);
}
