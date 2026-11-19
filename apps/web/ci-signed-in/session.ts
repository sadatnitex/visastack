import type { BrowserContext } from '@playwright/test';
import { type Role, person } from './people';

/** Neon Auth's session cookie in the pinned SDK (pinned by scripts/ci-signed-in.test.mjs). */
export const SESSION_COOKIE = '__Secure-neon-auth.session_token';

/**
 * Signs the browser context in as one made-up person, with no sign-in form: it carries the
 * person's session cookie for this run, exactly as a real sign-in would leave it. The unchanged app
 * then asks the stand-in sign-in service who owns the cookie, and every real check (sign-in
 * middleware, account mapping, session age, pilot access) runs as in production.
 *
 * Usable in a loop over routes (U1b-2): call once per context, then visit any number of pages.
 */
export async function signInAs(
  context: BrowserContext,
  role: Role,
  baseURL: string,
): Promise<void> {
  const url = new URL(baseURL);
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('signInAs only signs in on this machine.');
  }
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: person(role).token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}
