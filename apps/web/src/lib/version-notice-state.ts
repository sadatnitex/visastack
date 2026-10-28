import { cookies } from 'next/headers';
import { VERSION_NOTICE_COOKIE, parseVersionNoticeSeen } from './version-notice';

/**
 * Whether this device has already seen the notice about this version, for the root layout. With
 * no request to read (a unit test) or an unavailable cookie store, the answer is "not seen", so
 * the notice shows in full: a display preference never hides it by mistake. Next's own signals (a
 * page found to be per-request while it is built) carry a string `digest` and go back to Next
 * unchanged, as in `signed-in.ts`, so a page is never frozen at build time with the wrong answer.
 */
export async function hasSeenVersionNotice(): Promise<boolean> {
  try {
    return parseVersionNoticeSeen((await cookies()).get(VERSION_NOTICE_COOKIE)?.value);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { digest?: unknown }).digest === 'string'
    )
      throw error;
    return false;
  }
}
