import { triggerLegalHoldReviewReminderSweep } from '../../../../lib/jobs';

/**
 * Pushes a real reminder to every current COMPLIANCE_ADMIN once a legal
 * hold becomes overdue for review (directive Part 7 §13: "any scheduled
 * reminder when a hold becomes due"). Same cron-authentication shape as
 * every other job route. Deliberately re-runs every day like the rest of
 * this cron file, not just once: an overdue hold that stays overdue keeps
 * getting nudged at `legalHoldReminderIntervalDays()`'s own cadence, not a
 * single notice that goes silent if missed.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

const MAX_BATCHES_PER_SWEEP = 20;
const BATCH_SIZE = 50;

export async function GET(request: Request): Promise<Response> {
  const secret = readEnv('CRON_SECRET');
  if (!secret) {
    return new Response('CRON_SECRET not configured', { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }

  let checked = 0;
  let notified = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerLegalHoldReviewReminderSweep({ limit: BATCH_SIZE });
    checked += result.checked;
    notified += result.notified;
    if (result.notified < BATCH_SIZE) break; // caught up
  }

  return Response.json({ checked, notified });
}
