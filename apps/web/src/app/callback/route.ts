import { randomUUID } from 'node:crypto';
import { handleAuth } from '@workos-inc/authkit-nextjs';
import { NextResponse } from 'next/server';

/**
 * WorkOS AuthKit callback. Exchanges the authorization code for a session and
 * redirects the user into the app. The redirect URI registered in WorkOS points
 * here (`/callback`).
 *
 * `onError` (master directive §8A.8 — "authentication errors produce
 * recoverable user messaging and a safe reference ID"): AuthKit's own default
 * error response is a bare `{ message, description }` JSON body with HTTP 500
 * — by design, for *any* callback failure (missing `code`/`state`, an expired
 * or mismatched PKCE cookie, a stale link, etc.), not only a genuine crash.
 * That default is neither recoverable UI nor auditable-by-reference, so we
 * redirect to the landing page with a short, non-PII reference id instead. The
 * real error is logged server-side (never sent to the browser); the browser
 * only ever sees the reference id.
 */
export const GET = handleAuth({
  returnPathname: '/app',
  onError: async ({ error, request }) => {
    const referenceId = randomUUID().slice(0, 8);
    console.error('[callback] sign-in did not complete', referenceId, error);
    const target = new URL('/', request.url);
    target.searchParams.set('auth_error', referenceId);
    return NextResponse.redirect(target);
  },
});
