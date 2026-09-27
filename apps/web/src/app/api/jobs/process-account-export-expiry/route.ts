import { triggerAccountExportExpirySweep } from '../../../../lib/jobs';

/**
 * Purges account export artifacts past their 24h (default) expiry, and any
 * whose owning account has since been deleted (PRV-04, master directive
 * Part 7 §14 "Large export" - "max 24h artifact"). A dedicated cron,
 * separate from `process-account-exports`, mirroring the closed-case
 * notice/purge split (`process-case-retention-notices` vs
 * `process-case-retention-purge`) - producing new artifacts and expiring
 * old ones are distinct concerns with different failure modes. Same
 * cron-authentication shape as every other job route.
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

  let totalExpired = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerAccountExportExpirySweep({ limit: BATCH_SIZE });
    totalExpired += result.expired;
    if (result.expired < BATCH_SIZE) break; // caught up
  }

  return Response.json({ expired: totalExpired });
}
