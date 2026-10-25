import type { NextRequest } from 'next/server';
import { createCspMiddleware } from './lib/csp-middleware';
import { isNeonProtectedPath } from './lib/identity-selection';

/**
 * Neon Auth sign-in check, the only sign-in system. The Neon package is loaded on first use.
 * Unsigned-in visitors to protected pages are sent to `/auth/sign-in`.
 */
async function neonMiddleware(request: NextRequest) {
  const { getNeonAuth } = await import('./lib/neon-auth');
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  return getNeonAuth().middleware({ loginUrl: `/auth/sign-in?next=${encodeURIComponent(next)}` })(
    request,
  );
}

/**
 * The site-wide Content-Security-Policy (Commercial V1 SEC-02) is built per
 * request, because its script nonce must be unique to the request, so it has
 * to be applied here. The Neon sign-in check runs only on protected pages
 * (`isNeonProtectedPath`); every other page, including `/trust` and the
 * not-found page, gets the policy and nothing else.
 */
export default createCspMiddleware({
  auth: neonMiddleware,
  needsSignIn: isNeonProtectedPath,
  enabled: process.env.NODE_ENV === 'production',
  readEnv: (name) => process.env[name],
});

export const config = {
  // Every route that renders a page, so that every page response carries the
  // policy. API routes are left out: they return JSON or bytes and set their own
  // headers (`/api/blob/[key]` ships its own sandboxing policy). Next's static
  // assets and image optimizer are not documents. Which of these routes need a
  // signed-in session is decided by `isNeonProtectedPath`.
  matcher: ['/((?!api/|_next/static/|_next/image|favicon.ico).*)'],
};
