import { NextResponse } from 'next/server';
import { signInNextSuffix } from '../../../lib/confirmed-landing';
import { safeReturnPath } from '../../../lib/neon-recency';
import { requestOrigin } from '../../../lib/social-sign-in';

export const dynamic = 'force-dynamic';

/**
 * Where the email sign-in link returns to (Q8). The sign-in check in `middleware.ts` runs on this
 * path first and hands over the sign-in Neon Auth made when the link was opened. Then, in order:
 *
 * 1. No sign-in: the sign-in form with the link message.
 * 2. This browser did not ask for a link (no valid "link pending" cookie): the new sign-in is
 *    ended at once, so a link someone else asked for can never sign this browser in.
 * 3. Staff: the sign-in is ended and the person is asked to sign in with the password; a link
 *    never makes a staff sign-in.
 * 4. A new person: the agreement and invitation step (`/auth/notice-check`) first.
 * 5. Everyone else: on to the validated destination.
 *
 * Anything unreadable ends the link sign-in rather than letting it through.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const origin = requestOrigin(request);
  const destination = safeReturnPath(new URL(request.url).searchParams.get('next'));
  const go = (path: string) => NextResponse.redirect(new URL(path, origin));
  const toSignIn = (code: string) => go(`/auth/sign-in?e=${code}${signInNextSuffix(destination)}`);

  const { cookies } = await import('next/headers');
  const store = await cookies();
  const guard = await import('../../../lib/sign-in-link-guard');
  const { getNeonAuth, readNeonAuthSettings } = await import('../../../lib/neon-auth');
  const secure = origin.startsWith('https://');
  const pendingName = guard.linkPendingCookieName(secure);
  const pending = store.get(pendingName)?.value;
  store.set(pendingName, '', { ...guard.linkPendingCookieOptions(secure), maxAge: 0 });

  let user: { id: string; email: string } | undefined;
  try {
    const { requestSessionReader } = await import('../../../lib/neon-request-session');
    const { data } = await requestSessionReader().getSession();
    if (data?.user?.id) user = { id: data.user.id, email: data.user.email };
  } catch {
    user = undefined;
  }
  if (!user) return toSignIn('link');

  const endSignIn = async (code: string) => {
    try {
      await getNeonAuth().signOut();
    } catch (error) {
      const { reportServerError } = await import('../../../lib/server-error');
      reportServerError('linkReturn', error, { step: 'sign-out' });
    }
    return toSignIn(code);
  };

  let askedHere = false;
  try {
    askedHere = guard.linkPendingValid(pending, readNeonAuthSettings().cookieSecret);
  } catch {
    askedHere = false;
  }
  if (!askedHere) return endSignIn('link');

  const staff = await guard.emailIsStaff(user.email);
  if (staff !== false) return endSignIn(staff === null ? 'link' : 'link_staff');

  let mustAgree: boolean;
  try {
    const { mustAcknowledgeNotices } = await import('../../../lib/notice-gate');
    const { withPublicDb } = await import('../../../lib/public-db');
    mustAgree = await withPublicDb((db) => mustAcknowledgeNotices(db, user));
  } catch {
    // `withSession` asks again, so nobody gets an account without agreeing.
    mustAgree = false;
  }
  return go(mustAgree ? `/auth/notice-check?next=${encodeURIComponent(destination)}` : destination);
}
