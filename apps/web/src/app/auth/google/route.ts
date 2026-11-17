import { NextResponse } from 'next/server';
import { resolveBaseUrl } from '../../../lib/base-url';
import {
  CONFIRMED_PATH,
  confirmedCallbackNext,
  signInNextSuffix,
} from '../../../lib/confirmed-landing';
import { safeReturnPath } from '../../../lib/neon-recency';
import { googleSignInEnabled, safeProviderRedirect } from '../../../lib/social-sign-in';

export const dynamic = 'force-dynamic';

/**
 * Starts "Continue with Google". A plain link on the sign-in and sign-up pages points here; this
 * asks Neon Auth for Google's sign-in address and sends the browser there. It is a link and not a
 * form on purpose: the page's content policy limits where a form may send the browser, and a link
 * is not limited that way.
 *
 * Nothing here decides who gets in. Neon Auth completes the sign-in, and then every request goes
 * through the same checks as an email sign-in: the invitation check (`pilot-access.ts`), the
 * confirmed-email rule and the account binding (`provisionAccount`), which refuses an email that
 * already belongs to a different identity. There is no per-address limit on this step because it
 * takes no email, sends nothing and guesses nothing; Google and Neon Auth apply their own limits.
 *
 * Failures send the person back to the sign-in form with a fixed code, never text from a provider.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const next = safeReturnPath(new URL(request.url).searchParams.get('next'));
  const base = resolveBaseUrl();
  const back = (code: 'social' | 'social_off') =>
    NextResponse.redirect(new URL(`/auth/sign-in?e=${code}${signInNextSuffix(next)}`, base));

  if (!googleSignInEnabled()) return back('social_off');
  try {
    const { getNeonAuth } = await import('../../../lib/neon-auth');
    const { data, error } = await getNeonAuth().signIn.social({
      provider: 'google',
      // The same landing page the email confirmation link uses: the sign-in check runs on it
      // first, so the sign-in Neon Auth just made is passed on, then the person goes on to `next`.
      callbackURL: `${base}${CONFIRMED_PATH}?next=${confirmedCallbackNext(next)}`,
      errorCallbackURL: `${base}/auth/sign-in?e=social${signInNextSuffix(next)}`,
      disableRedirect: true,
    });
    const target = safeProviderRedirect(data?.url);
    if (error || !target) return back('social');
    return NextResponse.redirect(target);
  } catch {
    return back('social');
  }
}
