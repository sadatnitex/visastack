'use client';

import { useEffect } from 'react';

/**
 * WP-SB8 landing helper. The six story sections are details groups that start closed (scroll
 * budget). A link to one of them, such as the site menu's "How It Works" (`/#how-it-works`), must
 * open it, but browsers only open a closed group on a full page load into its content, and the
 * menu's links move within the page without one. This opens the named group on load, on a hash
 * change and on any click of a link to it (before the page scrolls), then scrolls it into view.
 *
 * It also makes the product card row a keyboard stop only while it scrolls sideways (phones). The
 * server sends it focusable, so the row stays reachable without script; on a desktop, where the
 * cards sit in a grid, the stop is removed.
 */
export function LandingStoryHelper({
  groupIds,
  rowSelector,
}: {
  readonly groupIds: readonly string[];
  readonly rowSelector: string;
}) {
  useEffect(() => {
    const known = new Set(groupIds);
    const openGroup = (raw: string, scroll: boolean) => {
      let id = '';
      try {
        id = decodeURIComponent(raw.replace(/^#/, ''));
      } catch {
        return;
      }
      if (!known.has(id)) return;
      const group = document.getElementById(id);
      if (!(group instanceof HTMLDetailsElement)) return;
      group.open = true;
      if (scroll) group.scrollIntoView({ block: 'start' });
    };

    openGroup(window.location.hash, true);
    const onHash = () => openGroup(window.location.hash, true);
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href*="#"]');
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.pathname !== window.location.pathname || link.origin !== window.location.origin)
        return;
      // Open first; the page's own scroll to the target then lands on the open group.
      openGroup(link.hash, false);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    document.addEventListener('click', onClick, true);

    const row = document.querySelector<HTMLElement>(rowSelector);
    const fitStop = () => {
      if (!row) return;
      if (row.scrollWidth > row.clientWidth + 1) row.setAttribute('tabindex', '0');
      else row.removeAttribute('tabindex');
    };
    fitStop();
    const observer =
      row && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitStop) : null;
    if (row) observer?.observe(row);

    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
      document.removeEventListener('click', onClick, true);
      observer?.disconnect();
    };
  }, [groupIds, rowSelector]);
  return null;
}
