import { systemPrincipal } from '@visastack/services';
import { after } from 'next/server';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerBillingCycle, triggerNotificationWorker } from '../../../../lib/jobs';

/**
 * The daily billing run (S17, ADR 0020 Phase 2). Creates each agency's invoice for the plan
 * period running now (once: a rerun creates nothing), queues reminders 3 days before, on, and 3
 * and 7 days after each due date, and, only when the owner has switched automatic Grace and
 * Suspended on in Billing Rules, moves agencies whose invoice stays unpaid. Paying in full ends a
 * Grace or Suspended status VisaStack set; a status a person set is never changed. Does nothing
 * before migration 0103. Scheduled daily (see `apps/web/vercel.json`) and signed with the cron
 * secret; fails closed (503) if the secret is not configured. Returns counts only.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;
  const result = await triggerBillingCycle(systemPrincipal('process-billing-cycle'));
  // A run that could not start, or found migration 0103 missing, must not read as "nothing to
  // do"; nor a run where every piece of work failed.
  const stopped =
    'error' in result ||
    !result.available ||
    (result.failed > 0 &&
      result.invoicesCreated +
        result.remindersQueued +
        result.movedToGrace +
        result.movedToSuspended +
        result.returnedToActive ===
        0);
  // Notices this run queued go out now, not at the next day's sending run.
  if (!('error' in result) && result.available) {
    after(() => triggerNotificationWorker().then(() => undefined));
  }
  return Response.json(result, { status: stopped ? 503 : 200 });
}
