import type { WorkspaceToolbarState } from '@visastack/services';
import type { NavLink } from './navigation';
import { SHARING_AND_REQUESTS } from './workspace-navigation';

/**
 * The counts for the phone bar's tabs (like the red number on a Facebook or Daraz tab), made only
 * from the unread notice counts the workspace already loads for the bell. Nothing new is read.
 *
 * - Sharing & Requests: unread notices about a request waiting on the traveller.
 * - Home: every other unread notice.
 *
 * The words around them say "new", not "waiting": an unread notice is not the same thing as a
 * request that is still open. A destination with no count is left out of the map.
 */
export function tabBadges(
  links: readonly NavLink[],
  state: Pick<WorkspaceToolbarState, 'unread' | 'unreadRequests'> | undefined,
): Readonly<Record<string, number>> {
  if (!state) return {};
  const requests = Math.min(state.unreadRequests ?? 0, state.unread);
  const rest = Math.max(0, state.unread - requests);
  const out: Record<string, number> = {};
  for (const link of links) {
    if (link.label === 'Home' && link.exact && rest > 0) out[link.href] = rest;
    if (link.label === SHARING_AND_REQUESTS && requests > 0) out[link.href] = requests;
  }
  return out;
}
