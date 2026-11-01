'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

const CASE_ANCHOR = /^#mission-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The address a link to one case should open (WP-SB5), or null when the address already names a
 * case or carries no case anchor. Older links (Do Next, saved bookmarks) point at `#mission-<id>`
 * only; the page now opens a case from `?case=<id>`, so such a link is turned into that. Only the
 * shape is checked here: the server decides whether this person may see the case.
 */
export function openCaseAddress(pathname: string, search: string, hash: string): string | null {
  const match = hash.match(CASE_ANCHOR);
  if (!match?.[1]) return null;
  const params = new URLSearchParams(search);
  if (params.has('case')) return null;
  const missionId = match[1].toLowerCase();
  params.set('case', missionId);
  return `${pathname}?${params.toString()}#mission-${missionId}`;
}

/** Opens the case an anchor-only link points at, once, without adding a history entry. */
export function OpenCaseFromLink() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const target = openCaseAddress(pathname, window.location.search, window.location.hash);
    if (target) router.replace(target);
  }, [pathname, router]);
  return null;
}
