import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
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

const MAX_BATCHES_PER_SWEEP = 20;
const BATCH_SIZE = 50;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;

  let totalExpired = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerAccountExportExpirySweep({ limit: BATCH_SIZE });
    totalExpired += result.expired;
    if (result.expired < BATCH_SIZE) break; // caught up
  }

  return Response.json({ expired: totalExpired });
}
