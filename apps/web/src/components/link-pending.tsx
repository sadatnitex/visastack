'use client';

import { useLinkStatus } from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Sits inside a navigation link and says, the moment the link is tapped, that its page is on the
 * way. The page itself is built on the server, so there is a wait; the stylesheet gives the tapped
 * link its selected look and takes the mark off the page being left. It draws nothing itself and is
 * hidden from screen readers.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span className="link-pending" data-pending={pending ? 'true' : 'false'} aria-hidden="true" />
  );
}

/** Longest the bar runs, so a page that never arrives cannot leave it running for ever. */
const LONGEST_WAIT_MS = 10_000;

/**
 * Whether a click on `anchor` starts a visit to another page of this site: an ordinary tap, no
 * new tab, no download, no modifier key, and an address other than the one already shown.
 */
function startsVisit(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const to = new URL(anchor.href, window.location.href);
  if (to.origin !== window.location.origin) return false;
  return to.pathname + to.search !== window.location.pathname + window.location.search;
}

/**
 * The thin bar at the top of the workspace. It runs from a tap on any link to another page until
 * the address changes (the page has arrived), so cards, breadcrumbs and table rows answer a tap as
 * well as the navigation bars do. It is hidden from screen readers.
 */
export function RouteProgress() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let watch: ReturnType<typeof setInterval> | undefined;
    let stop: ReturnType<typeof setTimeout> | undefined;
    const end = () => {
      clearInterval(watch);
      clearTimeout(stop);
      setActive(false);
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || !startsVisit(event, anchor)) return;
      const from = window.location.href;
      end();
      setActive(true);
      watch = setInterval(() => {
        if (window.location.href !== from) end();
      }, 100);
      stop = setTimeout(end, LONGEST_WAIT_MS);
    };
    // In the capture phase: the framework's own link handler cancels the browser's navigation
    // while it takes over, so a later listener could not tell a visit from a cancelled tap.
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      end();
    };
  }, []);
  return (
    <div className="route-progress" data-active={active ? 'true' : 'false'} aria-hidden="true" />
  );
}
