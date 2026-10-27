import { after } from 'next/server';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerNotificationWorker } from '../../../../lib/jobs';
import { runWhatsAppInbox } from './run';

/**
 * Daily backstop for the WhatsApp inbox (Lane D). Each webhook delivery is normally handled
 * straight after it arrives; this pass picks up anything left over (a crash, a deploy, a
 * timeout) and removes channel data past its retention. Cron-signed like every job route, and it
 * does nothing while the channel is off.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;

  const result = await runWhatsAppInbox({ purge: true });
  // Emails this run queued go out now, not at the next day's sending run.
  after(() => triggerNotificationWorker().then(() => undefined));
  return Response.json(result, { status: result.status === 'unavailable' ? 503 : 200 });
}
