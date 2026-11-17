import { type NextRequest, NextResponse } from 'next/server';
import { LINK_RETURN_PATH, signInNextSuffix } from './confirmed-landing';
import { linkPendingCookieName, linkPendingValid } from './link-pending';
import { safeReturnPath } from './safe-return-path';

/**
 * The first check on the sign-in link landing (Q8), run by the sign-in filter BEFORE Neon Auth
 * hands over the sign-in the link made. A browser that never asked for a link (no valid, unexpired
 * "link pending" mark) is sent to the sign-in form with the plain link message, and no sign-in is
 * created here at all. Null means "carry on to Neon Auth's own check".
 */
export async function refuseUnaskedLink(
  request: NextRequest,
  readEnv: (name: string) => string | undefined,
): Promise<NextResponse | null> {
  if (request.nextUrl.pathname !== LINK_RETURN_PATH) return null;
  const secure = request.nextUrl.protocol === 'https:';
  const mark = request.cookies.get(linkPendingCookieName(secure))?.value;
  const secret = readEnv('NEON_AUTH_COOKIE_SECRET') ?? '';
  if (await linkPendingValid(mark, secret)) return null;
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  return NextResponse.redirect(
    new URL(`/auth/sign-in?e=link${signInNextSuffix(next)}`, request.url),
  );
}
