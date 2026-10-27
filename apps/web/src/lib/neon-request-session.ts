import 'server-only';
import type { NeonAuth } from '@neondatabase/auth/next/server';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getNeonAuth } from './neon-auth';

/**
 * Reads the signed-in session from Neon Auth at most once per page request.
 *
 * One page render used to ask Neon Auth for the same session several times: the site header,
 * the workspace frame, the page itself, and the session-age check inside each of those. React
 * `cache()` keeps the answer for the rest of that one render only. It is thrown away when the
 * render ends, so the next request always asks Neon Auth again: a signed-out or expired session
 * is noticed on the very next request, exactly as before.
 *
 * Outside a page render (server actions, route handlers, tests) `cache()` does no caching at all,
 * so every call there still asks Neon Auth directly.
 */
type RequestSession = ReturnType<NeonAuth['getSession']>;

/**
 * Neon Auth's own server code forwards only the cookies whose names start with this prefix when
 * it asks its service for the session (`extractNeonAuthCookies` in `@neondatabase/auth`, pinned by
 * a test). A request carrying none of them sends that service an empty cookie header, which can
 * only ever answer "nobody is signed in".
 */
export const NEON_AUTH_COOKIE_PREFIX = '__Secure-neon-auth';

/** The answer Neon Auth gives for a visitor with no session, without the trip to ask for it. */
const SIGNED_OUT = { data: null, error: null };

/**
 * A visitor with no Neon Auth cookie at all (almost every visitor to the public pages, whose shared
 * header asks this on every page) is answered here instead of with a network request whose answer
 * is already known. Any Neon Auth cookie, valid or not, still goes to Neon Auth exactly as before.
 */
async function readSession(): Promise<Awaited<RequestSession>> {
  const store = await cookies();
  const carriesNeonAuthCookie = store
    .getAll()
    .some((cookie) => cookie.name.startsWith(NEON_AUTH_COOKIE_PREFIX));
  if (!carriesNeonAuthCookie) return SIGNED_OUT as Awaited<RequestSession>;
  return getNeonAuth().getSession();
}

const readRequestSession: () => RequestSession = cache(readSession) as () => RequestSession;

/** A session reader shared by `NeonIdentityPort` and the session-age check: one read per request. */
export function requestSessionReader(): { getSession(): RequestSession } {
  return { getSession: () => readRequestSession() };
}
