import { neonReauthUrl, safeReturnPath } from '../../../lib/neon-recency';

/**
 * Where a stale session is sent to sign in again: the Neon password re-check page.
 *
 * `returnTo` never becomes an off-app redirect: only a same-origin relative path is accepted, and
 * anything else falls back to `/app`, regardless of what a caller supplies.
 */
export async function GET(request: Request): Promise<Response> {
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get('returnTo'));
  return Response.redirect(new URL(neonReauthUrl(returnTo), request.url), 302);
}
