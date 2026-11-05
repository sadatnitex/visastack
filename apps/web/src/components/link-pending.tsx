'use client';

import { useLinkStatus } from 'next/link';

/**
 * Sits inside a navigation link and says, the moment the link is tapped, that its page is on the
 * way. The page itself is built on the server, so there is a wait; this makes the wait visible:
 * the stylesheet marks the tapped link and shows the thin bar at the top of the workspace for as
 * long as any link is waiting. It draws nothing itself and is hidden from screen readers.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span className="link-pending" data-pending={pending ? 'true' : 'false'} aria-hidden="true" />
  );
}

/** The thin bar at the top of the workspace. Only the stylesheet shows it, while a link is waiting. */
export function RouteProgress() {
  return <div className="route-progress" aria-hidden="true" />;
}
