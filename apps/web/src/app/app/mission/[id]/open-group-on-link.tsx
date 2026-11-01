'use client';

import { useEffect } from 'react';

function openAround(id: string, scope: Element): void {
  const target = id ? document.getElementById(id) : null;
  if (!target || !scope.contains(target)) return;
  // Every closed group around the target opens, so a row folded inside a group shows too.
  for (let node = target.closest('details'); node && scope.contains(node); ) {
    if (!node.open) node.open = true;
    node = node.parentElement?.closest('details') ?? null;
  }
}

/**
 * WP-SB2: the case checklist sits in groups that open and close, and links on the page point at
 * one group, either by its id or by naming it in `data-open-group` (for example "3 need a check",
 * which points at the whole checklist). This opens the group a link points at, so the rows the
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
      // A link can name the group it means (`data-open-group`) while pointing at the whole
      // checklist, for example "3 need a check".
      const named = link?.getAttribute('data-open-group');
      if (named) openAround(named, scope);
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
