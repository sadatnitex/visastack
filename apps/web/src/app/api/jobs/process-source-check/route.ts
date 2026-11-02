import { systemPrincipal } from '@visastack/services';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerSourceCheck } from '../../../../lib/jobs';

/**
 * The weekly official-source check (UMPE P10), called daily at 03:00 UTC (09:00 Asia/Dhaka,
 * `0 3 * * *` in apps/web/vercel.json and the Render fallback mirror). On a Dhaka Saturday it starts
 * the week's check of the registered official pages under fixed safety rules; on other days it only
 * finishes that week's check when pages were left, else does nothing. It records candidate changes
 * for a person to review in Pack Studio and never changes a pack. Keyed by the Dhaka week, so a
 * retry runs nothing twice.
 * Signed by the scheduler with `Authorization: Bearer $CRON_SECRET`, checked first; fails closed
 * (503) when the secret is not set. Answers with counts only: no address or page text. A manual
 * Check Now is an admin action on the Official Sources page, never a parameter here.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;

  const summary = await triggerSourceCheck(systemPrincipal('process-source-check'));
  if ('error' in summary) return Response.json({ error: summary.error }, { status: 503 });
  return Response.json({
    status: summary.status,
    sourcesDue: summary.sourcesDue,
    checked: summary.checked,
    changed: summary.changed,
    blocked: summary.blocked,
    failed: summary.failed,
    unsupported: summary.unsupported,
    deferred: summary.deferred,
  });
}
