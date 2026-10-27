import { systemPrincipal } from '@visastack/services';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerPaymentReconciliation } from '../../../../lib/jobs';

/**
 * Settles online invoice payments the gateway has not reported on (S11, ADR 0020). Payments left
 * open for more than 15 minutes are checked with the gateway; ones still unconfirmed after 24
 * hours are closed as expired; a late success after expiry is still found for 7 days. Safe to run
 * again and again: every payment is judged by the same checks and counted at most once. Does
 * nothing while no payment provider is configured. Scheduled daily (see `apps/web/vercel.json`)
 * and signed with the cron secret; fails closed (503) if the secret is not configured. Returns
 * counts only.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;
  const result = await triggerPaymentReconciliation(
    systemPrincipal('process-payment-reconciliation'),
  );
  // A run that could not start, or found the table missing, must not read as "nothing to do".
  // Also when every payment asked about could not be answered: a wrong store setting or a wrong
  // mode then shows as a failed run instead of a quiet 200.
  const stopped =
    'error' in result ||
    !result.available ||
    (result.checked > 0 && result.unavailable === result.checked);
  return Response.json(result, { status: stopped ? 503 : 200 });
}
