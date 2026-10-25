import 'server-only';
import type { NeonAuth } from '@neondatabase/auth/next/server';
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

const readRequestSession: () => RequestSession = cache(() => getNeonAuth().getSession());

/** A session reader shared by `NeonIdentityPort` and the session-age check: one read per request. */
export function requestSessionReader(): { getSession(): RequestSession } {
  return { getSession: () => readRequestSession() };
}
