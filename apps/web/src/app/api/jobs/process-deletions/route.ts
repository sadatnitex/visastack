import { triggerAccountDeletionSweep, triggerErasureWorker } from '../../../../lib/jobs';

/**
 * Executes every account deletion request whose grace window has elapsed
 * (master directive §7 "PR 4"). `requestDeletionAction`/`cancelDeletionAction`
 * only open or cancel a request — this is the only thing that ever calls
 * `executeAccountDeletion`, so without it a due request would sit at PENDING
 * forever. Configured as a Vercel Cron target (see `apps/web/vercel.json`);
 * Vercel signs cron-triggered requests with `Authorization: Bearer
 * $CRON_SECRET` when `CRON_SECRET` is set on the project, which this route
 * verifies. Fails closed (503) if the secret isn't configured — never runs
 * unauthenticated.
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

  const { executed } = await triggerAccountDeletionSweep();
  // Each executed deletion enqueues erasure jobs; run a bounded pass now
  // rather than waiting for the next independent erasure sweep.
  const erasure =
    executed > 0 ? await triggerErasureWorker() : { processed: 0, blocked: 0, failed: 0 };

  return Response.json({ executed, erasure });
}
