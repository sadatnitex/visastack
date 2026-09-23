import { triggerDowngradeSweep } from '../../../../lib/jobs';

/**
 * Executes every scheduled downgrade whose effective date has arrived
 * (Commercial V1 COM-02, Part 5 §7 "Downgrade"). `scheduleDowngrade`/
 * `cancelScheduledDowngrade` only open or cancel a schedule -- this is the
 * only thing that ever calls `executeScheduledDowngrade`, so without it a
 * due downgrade would sit at PENDING forever. Configured as a Vercel Cron
 * target (see `apps/web/vercel.json`); Vercel signs cron-triggered requests
 * with `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set on the
 * project, which this route verifies. Fails closed (503) if the secret
 * isn't configured -- never runs unauthenticated.
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

  const { executed } = await triggerDowngradeSweep();
  return Response.json({ executed });
}
