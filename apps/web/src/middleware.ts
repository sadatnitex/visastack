import { authkitMiddleware } from '@workos-inc/authkit-nextjs';
import { isAuthkitPath } from './lib/authkit-paths';
import { createCspMiddleware } from './lib/csp-middleware';

/**
 * AuthKit middleware with `middlewareAuth` enabled.
 *
 * Enabling middleware-level auth makes the middleware the single place that
 * performs the WorkOS session handshake AND the access-token refresh. Both
 * write cookies, which is only legal in middleware or a route handler — never
 * during a Server Component render. With this enabled, protected pages call
 * `withAuth()` only to *read* the (already-refreshed) session, so no cookie
 * write ever falls into the RSC. Without it, `withAuth({ ensureSignedIn })` in a
 * page triggers the refresh during render and throws "Cookies can only be
 * modified in a Server Action or Route Handler".
 *
 * Everything AuthKit handles requires a signed-in user except the paths in
 * `unauthenticatedPaths` (public landing, status, and the OAuth callback);
 * unauthenticated visitors to protected routes are redirected to sign-in by the
 * middleware itself.
 */
const authkit = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ['/', '/status', '/callback'],
  },
});

/**
 * The site-wide Content-Security-Policy (Commercial V1 SEC-02) is built per
 * request, because its script nonce must be unique to the request, so it has
 * to be applied here. AuthKit is wrapped unchanged and still handles exactly
 * the routes it handled before (`lib/authkit-paths.ts`); every other page,
 * including `/trust` and the not-found page, gets the policy and nothing else.
 */
export default createCspMiddleware({
  authkit,
  isAuthkitPath,
  enabled: process.env.NODE_ENV === 'production',
  readEnv: (name) => process.env[name],
});

export const config = {
  // Every route that renders a page, so that every page response carries the
  // policy. API routes are left out: they return JSON or bytes and set their own
  // headers (`/api/blob/[key]` ships its own sandboxing policy). Next's static
  // assets and image optimizer are not documents. Which of these routes AuthKit
  // also handles is decided in `lib/authkit-paths.ts`.
  matcher: ['/((?!api/|_next/static/|_next/image|favicon.ico).*)'],
};
