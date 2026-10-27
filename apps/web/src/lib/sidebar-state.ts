import { cookies } from 'next/headers';
import { SIDEBAR_COOKIE, type SidebarState, parseSidebarState } from './sidebar-preference';

/**
 * The sidebar state this device chose, for the signed-in layout. When there is no request to read
 * (a unit test, a static render) or the cookie store is unavailable, the normal open sidebar is
 * the answer, so the layout never fails over a display preference.
 */
export async function getSidebarState(): Promise<SidebarState> {
  try {
    return parseSidebarState((await cookies()).get(SIDEBAR_COOKIE)?.value);
  } catch {
    return 'expanded';
  }
}
