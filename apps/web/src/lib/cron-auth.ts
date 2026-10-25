import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readEnv } from './env';

/**
 * The one gate for scheduled-job routes. Vercel Cron signs its requests with
 * `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set on the project.
 *
 * Returns the response to send when the request must be refused, or `null` when the job may run.
 * Fails closed (503) when the secret is not configured, so a job never runs unauthenticated; the
 * reply stays neutral and never names the missing setting to an anonymous caller.
 * Both sides are hashed to a fixed length and compared in constant time, so neither the response
 * time nor a length mismatch reveals how much of a guess was right.
 */
export function rejectUnauthorizedCron(request: Request): Response | null {
  const secret = readEnv('CRON_SECRET');
  if (!secret) return new Response('Scheduled jobs unavailable', { status: 503 });
  const presented = request.headers.get('authorization') ?? '';
  if (!timingSafeEqual(sha256(presented), sha256(`Bearer ${secret}`))) {
    return new Response('forbidden', { status: 403 });
  }
  return null;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
