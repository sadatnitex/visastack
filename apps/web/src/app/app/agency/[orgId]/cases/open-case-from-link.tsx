'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** The anchor prefix of a case's workspace (a stored name kept in code, never shown). */
export const CASE_ANCHOR = 'mission-';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The address a link to one case should open (WP-SB5), or null when the address already names a
 * case or carries no case anchor. Older links (Do Next, the workspace search, saved bookmarks)
 * point at `#mission-<id>` only; the page now opens a case from `?case=<id>`, so such a link is
 * turned into that. Only the shape is checked here: the server decides whether this person may
 * see the case.
 */
export function openCaseAddress(pathname: string, search: string, hash: string): string | null {
  const prefix = `#${CASE_ANCHOR}`;
  if (!hash.startsWith(prefix)) return null;
  const id = hash.slice(prefix.length);
  if (!UUID.test(id)) return null;
  const params = new URLSearchParams(search);
  if (params.has('case')) return null;
  const missionId = id.toLowerCase();
  params.set('case', missionId);
  return `${pathname}?${params.toString()}#${CASE_ANCHOR}${missionId}`;
}

/**
 * Opens the case an anchor-only link points at: on arrival, when the anchor changes, and when such
 * a link is followed from this page itself (a link that only changes the anchor would otherwise
 * load nothing). A plain click only: a new tab or window keeps the ordinary link.
 */
export function OpenCaseFromLink() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const fromLocation = () => {
      const target = openCaseAddress(pathname, window.location.search, window.location.hash);
      if (target) router.replace(target);
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== pathname) return;
      const target = openCaseAddress(url.pathname, url.search, url.hash);
      if (!target) return;
      event.preventDefault();
      router.push(target);
    };
    fromLocation();
    window.addEventListener('hashchange', fromLocation);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('hashchange', fromLocation);
      document.removeEventListener('click', onClick, true);
    };
  }, [pathname, router]);
  return null;
}
