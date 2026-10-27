import { systemPrincipal } from '@visastack/services';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { triggerDataKeyRewrap } from '../../../../lib/jobs';

/**
 * Moves every stored data key from the local key to the real key service (S26, M18). Only the
 * wrapping changes; every encrypted value stays as it is. Safe to run again and again: a key
 * already moved is left alone, and a stop part way resumes next time. Not on a schedule: the
 * owner runs it once after switching the key service on, by calling this address with the cron
 * secret (steps in docs/operations/key-management.md). Fails closed (503) if the secret is not
 * configured. Returns counts only.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;
  return Response.json(await triggerDataKeyRewrap(systemPrincipal('rewrap-data-keys')));
}
