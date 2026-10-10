import { triggerIntakeWorker } from '../../../../lib/jobs';

/**
 * Periodic sweep for the low-volume durable job queue (master directive §5).
 *
 * The primary trigger is `after()` right after an upload — this route exists
 * as the durability backstop for whatever that doesn't catch: a crashed
 * invocation, a cold-start timeout, or any other reason a job was enqueued
 * but never claimed. Configured as a Vercel Cron target (see
 * `apps/web/vercel.json`); Vercel signs cron-triggered requests with
 * `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set on the
 * project, which this route verifies. Fails closed (503) if the secret isn't
 * configured — never runs unauthenticated.
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
const BATCH_SIZE = 5;

export async function GET(request: Request): Promise<Response> {
  const secret = readEnv('CRON_SECRET');
  if (!secret) {
    return new Response('CRON_SECRET not configured', { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }

  let totalProcessed = 0;
  let totalFailed = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerIntakeWorker({ limit: BATCH_SIZE });
    if (result.queued) return Response.json({ queued: true, processed: 0 }, { status: 202 });
    totalProcessed += result.processed;
    totalFailed += result.failed;
    if (result.processed + result.failed < BATCH_SIZE) break; // caught up
  }

  return Response.json({ processed: totalProcessed, failed: totalFailed });
}
