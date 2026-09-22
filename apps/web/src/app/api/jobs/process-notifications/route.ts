import { triggerNotificationWorker } from '../../../../lib/jobs';

/**
 * Periodic sweep for the notification outbox (NTF-02/§3, Part 5).
 *
 * The primary trigger is `after()` right after an event-enqueueing action
 * commits -- this route exists as the durability backstop for whatever that
 * doesn't catch: a crashed invocation, or a retry whose backoff has since
 * elapsed. Configured as a Vercel Cron target (see `apps/web/vercel.json`),
 * running far more often than the other daily sweeps -- "Targets: ...
 * email handoff <=5 minutes" demands it. Vercel signs cron-triggered
 * requests with `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is
 * set on the project, which this route verifies. Fails closed (503) if the
 * secret isn't configured -- never runs unauthenticated.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

// Bounded: drains up to this many batches per sweep so one invocation can't
// run unbounded even if the backlog is unexpectedly large.
const MAX_BATCHES_PER_SWEEP = 20;
const BATCH_SIZE = 20;

export async function GET(request: Request): Promise<Response> {
  const secret = readEnv('CRON_SECRET');
  if (!secret) {
    return new Response('CRON_SECRET not configured', { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }

  let totalSent = 0;
  let totalRetrying = 0;
  let totalFailed = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerNotificationWorker({ limit: BATCH_SIZE });
    totalSent += result.sent;
    totalRetrying += result.retrying;
    totalFailed += result.failed;
    if (result.sent + result.retrying + result.failed < BATCH_SIZE) break; // caught up
  }

  return Response.json({ sent: totalSent, retrying: totalRetrying, failed: totalFailed });
}
