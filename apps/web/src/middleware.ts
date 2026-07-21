import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

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
 * Everything under the matcher requires a signed-in user except the paths in
 * `unauthenticatedPaths` (public landing, status, and the OAuth callback);
 * unauthenticated visitors to protected routes are redirected to sign-in by the
 * middleware itself.
 */
export default authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ['/', '/status', '/callback'],
  },
});

export const config = {
  matcher: ['/', '/status', '/app', '/app/:path*', '/callback'],
};
