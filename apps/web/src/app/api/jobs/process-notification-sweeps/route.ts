import { triggerNotificationSweeps } from '../../../../lib/jobs';

/**
 * NTF-04 (Part 5 §4) date-threshold sweeps: task deadlines (7 days before;
 * 1 day before; overdue; bounded weekly overdue follow-up) and document/
 * verification expiry reminders (NTF-01's thresholds). Purely periodic --
 * there is no single domain-change moment to trigger off of the way the
 * event-driven notifications use `after()`, so this cron IS the only
 * trigger, run far more often than the once-daily sweeps below: "Targets:
 * ... date checks at least hourly." Vercel signs cron-triggered requests
 * with `Authorization: Bearer $CRON_SECRET`, which this route verifies;
 * fails closed (503) if the secret isn't configured.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

export async function GET(request: Request): Promise<Response> {
  const secret = readEnv('CRON_SECRET');
  if (!secret) {
    return new Response('CRON_SECRET not configured', { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }

  const result = await triggerNotificationSweeps({ limit: 200 });
  return Response.json(result);
}
