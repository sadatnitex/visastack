import {
  triggerAbandonedClientInvitationSweep,
  triggerAbandonedOrganizationInvitationSweep,
} from '../../../../lib/jobs';

/**
 * Purges abandoned organization- and client-invitation metadata (directive
 * Part 7 §11: "abandoned invite metadata: 30d") -- an invitation past its
 * own acceptance window, or explicitly revoked, for 30+ days on top of
 * that. Configured as a Vercel Cron target (see `apps/web/vercel.json`);
 * Vercel signs cron-triggered requests with `Authorization: Bearer
 * $CRON_SECRET` when `CRON_SECRET` is set on the project, which this route
 * verifies. Fails closed (503) if the secret isn't configured -- never runs
 * unauthenticated. Both invitation kinds are swept from one route since
 * they are the same retention class under one directive line, not two
 * independent concerns.
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
const BATCH_SIZE = 50;

export async function GET(request: Request): Promise<Response> {
  const secret = readEnv('CRON_SECRET');
  if (!secret) {
    return new Response('CRON_SECRET not configured', { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }

  let organizationChecked = 0;
  let organizationDeleted = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerAbandonedOrganizationInvitationSweep({ limit: BATCH_SIZE });
    organizationChecked += result.checked;
    organizationDeleted += result.deleted;
    if (result.checked < BATCH_SIZE) break; // caught up
  }

  let clientChecked = 0;
  let clientDeleted = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await triggerAbandonedClientInvitationSweep({ limit: BATCH_SIZE });
    clientChecked += result.checked;
    clientDeleted += result.deleted;
    if (result.checked < BATCH_SIZE) break; // caught up
  }

  return Response.json({
    organization: { checked: organizationChecked, deleted: organizationDeleted },
    client: { checked: clientChecked, deleted: clientDeleted },
  });
}
