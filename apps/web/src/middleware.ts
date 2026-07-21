import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

/**
 * AuthKit session middleware. It keeps the WorkOS session fresh on the routes
 * that use it; per-page protection is enforced with `withAuth({ ensureSignedIn })`.
 * Public routes (landing, status, health/blob APIs) are intentionally excluded.
 */
export default authkitMiddleware();

export const config = {
  matcher: ['/', '/status', '/app/:path*', '/callback'],
};
