import { NextResponse } from 'next/server';
import { withinAddressLimit } from '../../../lib/auth-throttle';
import { signInNextSuffix } from '../../../lib/confirmed-landing';
import { safeReturnPath } from '../../../lib/neon-recency';
import { reportServerError } from '../../../lib/server-error';
import {
  googleAuthorizationUrl,
  googleSignInEnabled,
  startedFromThisSite,
  withTimeout,
} from '../../../lib/social-sign-in';

export const dynamic = 'force-dynamic';

/** Long enough for a slow day at Neon Auth, short enough that a stall never becomes an error page. */
const NEON_AUTH_TIMEOUT_MS = 8000;

/**
 * Starts "Continue with Google". A plain link on the sign-in, sign-up and re-check pages points
 * here; this asks Neon Auth for Google's sign-in address and sends the browser there. It is a link
 * and not a form on purpose: the page's content policy limits where a form may send the browser
 * (and where the redirects after it may lead), and a link is not limited that way.
 *
 * Because a link is a plain GET, this route does the checks a form would have had:
 *  - the click must come from one of our own pages (`startedFromThisSite`), so another site, an
 *    email, a script or a crawler cannot start a sign-in for a visitor;
 *  - a limit on starts from one network address, before anything is sent to Neon Auth, which sees
 *    only this server's address and could not tell visitors apart;
 *  - the provider, return addresses and options are fixed here, never taken from the request, and
 *    the browser is sent only to Google's own sign-in address.
 *
 * Return addresses use the host the person is on, because the sign-in cookies Neon Auth sets here
 * belong to that host only. Neon Auth refuses a host it does not trust, which shows the fixed
 * message below and is logged (the log line never carries text from a provider).
 *
 * Nothing here decides who gets in. Neon Auth completes the sign-in, and then every request goes
 * through the same checks as an email sign-in: the invitation check (`pilot-access.ts`), the
 * confirmed-email rule and the account binding (`provisionAccount`), which refuses an email that
 * already belongs to a different identity.
 *
 * Failures send the person back to the sign-in form with a fixed code.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { origin, searchParams } = new URL(request.url);
  const next = safeReturnPath(searchParams.get('next'));
  const back = (code: 'social' | 'social_off' | 'social_start' | 'slow') =>
    NextResponse.redirect(new URL(`/auth/sign-in?e=${code}${signInNextSuffix(next)}`, origin));

  if (!googleSignInEnabled()) return back('social_off');
  if (!startedFromThisSite(request.headers, origin)) return back('social_start');
  if (!(await withinAddressLimit({ byAddress: 'AUTH_SIGN_IN_IP', onFailure: 'allow' }))) {
    return back('slow');
  }
  try {
    const { getNeonAuth } = await import('../../../lib/neon-auth');
    const { data, error } = await withTimeout(
      getNeonAuth().signIn.social({
        provider: 'google',
        // The path is written out (and pinned to `SOCIAL_RETURN_PATH` by a test) so the route
        // navigation check can see that the return page is reached.
        callbackURL: `${origin}/auth/social-return?next=${encodeURIComponent(next)}`,
        errorCallbackURL: `${origin}/auth/sign-in?e=social${signInNextSuffix(next)}`,
        disableRedirect: true,
      }),
      NEON_AUTH_TIMEOUT_MS,
    );
    const target = error ? null : googleAuthorizationUrl(data?.url);
    if (!target) {
      const detail = error as { status?: unknown; code?: unknown } | null;
      reportServerError('googleSignInStart', new Error('Neon Auth gave no Google address'), {
        step: 'start',
        status: String(detail?.status ?? ''),
        code: String(detail?.code ?? ''),
      });
      return back('social');
    }
    return NextResponse.redirect(target);
  } catch (error) {
    reportServerError('googleSignInStart', error, { step: 'start' });
    return back('social');
  }
}

/** A start is a GET only. Without this, Next would run the GET for HEAD requests too. */
export function HEAD(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET' } });
}
