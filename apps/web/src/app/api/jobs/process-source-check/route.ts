import { systemPrincipal } from '@visastack/services';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerSourceCheck } from '../../../../lib/jobs';

/**
 * The Saturday official-source check (UMPE P10): every Saturday at 09:00 Asia/Dhaka (03:00 UTC,
 * `0 3 * * 6` in apps/web/vercel.json and the Render fallback mirror) it fetches the registered
 * official pages under fixed safety rules and records candidate changes for a person to review in
 * Pack Studio. It never changes a pack. Keyed by the Dhaka week, so a retry runs nothing twice.
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
