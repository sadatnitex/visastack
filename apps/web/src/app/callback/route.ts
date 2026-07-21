import { handleAuth } from '@workos-inc/authkit-nextjs';

/**
 * WorkOS AuthKit callback. Exchanges the authorization code for a session and
 * redirects the user into the app. The redirect URI registered in WorkOS points
 * here (`/callback`).
 */
export const GET = handleAuth({ returnPathname: '/app' });
