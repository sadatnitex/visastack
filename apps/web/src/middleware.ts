import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

/**
 * AuthKit session middleware. It keeps the WorkOS session fresh on the routes
 * that use it; per-page protection is enforced with `withAuth({ ensureSignedIn })`.
 * Public routes (landing, status, health/blob APIs) are intentionally excluded.
 */
export default authkitMiddleware();

export const config = {
  // `/app` must be listed explicitly: the `/app/:path*` pattern does not match
  // the bare `/app` path, so without this the middleware is skipped there and
  // AuthKit's session-token refresh falls into the RSC render — which cannot
  // write cookies ("Cookies can only be modified in a Server Action or Route
  // Handler"). Listing `/app` lets the middleware refresh the token first.
  matcher: ['/', '/status', '/app', '/app/:path*', '/callback'],
};
