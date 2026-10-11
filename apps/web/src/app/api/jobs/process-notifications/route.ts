import { triggerNotificationWorker } from '../../../../lib/jobs';

/**
 * Periodic sweep for the notification outbox (NTF-02/§3, Part 5).
 *
 * The primary trigger is `after()` right after an event-enqueueing action
 * commits -- this route exists purely as the durability backstop for
 * whatever that doesn't catch: a crashed invocation, or a retry whose
 * backoff has since elapsed. Configured as a Vercel Cron target (see
 * `apps/web/vercel.json`), once daily -- this project is on Vercel's Hobby
 * plan, which rejects any cron schedule that would fire more than once a
 * day (a first attempt at a five-minute schedule here failed every
 * deployment until this was caught and fixed). "Targets: ... email
 * handoff <=5 minutes" is therefore met only via the `after()` primary
 * trigger, not by this cron's
 * own cadence -- an event whose `after()` call is somehow lost (e.g. the
 * request that enqueued it crashed before that callback ran) will not be
 * retried until this once-daily backstop runs, an honest, documented
 * degradation from the directive's target rather than a silent one. Vercel
 * signs cron-triggered requests with `Authorization: Bearer $CRON_SECRET`
 * when `CRON_SECRET` is set on the project, which this route verifies.
 * Fails closed (503) if the secret isn't configured -- never runs
 * unauthenticated.
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
  let totalDeferred = 0;
  const deadline = Date.now() + 45_000;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const remaining = deadline - Date.now();
    // Leave room for one bounded provider request and connection cleanup.
    if (remaining <= 10_000) break;
    const result = await triggerNotificationWorker({
      limit: BATCH_SIZE,
      timeBudgetMs: remaining - 10_000,
    });
    if (result.unavailable) return Response.json({ status: 'unavailable' }, { status: 503 });
    totalSent += result.sent;
    totalRetrying += result.retrying;
    totalFailed += result.failed;
    totalDeferred += result.deferred ?? 0;
    if (result.deferred || result.sent + result.retrying + result.failed < BATCH_SIZE) break;
  }

  return Response.json({
    sent: totalSent,
    retrying: totalRetrying,
    failed: totalFailed,
    deferred: totalDeferred,
  });
}
