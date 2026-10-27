/**
 * The signed-in sidebar can be hidden down to a slim rail on a laptop or larger. The choice is
 * remembered per device in one small cookie rather than local storage, because only a cookie
 * reaches the server: the page is then drawn in the right state on the first paint, with no
 * flash and no inline script (the page security policy admits only nonced scripts). It holds one
 * word and nothing about the person, and the page renders correctly when it is missing or blocked.
 */
export const SIDEBAR_COOKIE = 'visastack_sidebar';

export type SidebarState = 'expanded' | 'collapsed';

/** Anything but the exact word "collapsed" means the normal, expanded sidebar. */
export function parseSidebarState(value: string | undefined | null): SidebarState {
  return value === 'collapsed' ? 'collapsed' : 'expanded';
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The cookie text for a state: scoped to the signed-in area and sent only with same-site requests. */
export function sidebarCookie(state: SidebarState, secure: boolean): string {
  return [
    `${SIDEBAR_COOKIE}=${state}`,
    'path=/app',
    `max-age=${ONE_YEAR_SECONDS}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** Remember the choice on this device. A blocked cookie store only means it is not remembered. */
export function saveSidebarState(state: SidebarState): void {
  try {
    document.cookie = sidebarCookie(state, window.location.protocol === 'https:');
  } catch {
    // Not remembered; the sidebar still works for this visit.
  }
}
