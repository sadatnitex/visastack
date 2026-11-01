'use client';

import { useEffect } from 'react';

function openAround(id: string, scope: Element): void {
  const target = id ? document.getElementById(id) : null;
  if (!target || !scope.contains(target)) return;
  const group = target.closest('details');
  if (group && scope.contains(group) && !group.open) group.open = true;
}

/**
 * WP-SB2: the case checklist sits in groups that open and close, and links on the page point at
 * one group (for example "3 need a check"). This opens the group a link points at, so the rows the
 * person asked about are showing when the page scrolls there. It handles the address the page
 * opened with, a changed address, and a click on a same-page link (which raises no change event
 * when the address already ends with that anchor). Without script the group can still be opened by
 * hand, and nothing else on the page changes.
 */
export function OpenGroupOnLink({ scopeId }: { readonly scopeId: string }) {
  useEffect(() => {
    const scope = document.getElementById(scopeId);
    if (!scope) return;
    const fromHash = (hash: string) => {
      try {
        return decodeURIComponent(hash.slice(1));
      } catch {
        return '';
      }
    };
    const onHash = () => openAround(fromHash(window.location.hash), scope);
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href*="#"]');
      const href = link?.getAttribute('href');
      if (!href) return;
      let to: URL;
      try {
        to = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (to.origin !== window.location.origin || to.pathname !== window.location.pathname) return;
      openAround(fromHash(to.hash), scope);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick);
    };
  }, [scopeId]);
  return null;
}
