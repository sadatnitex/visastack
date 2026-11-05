'use client';

import { useEffect } from 'react';

/** Opens every closed rail fold around the element with this id; does nothing without one. */
function openFoldsAround(id: string): void {
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  for (
    let fold = target.closest<HTMLDetailsElement>('details.lift-fold');
    fold;
    fold = fold.parentElement?.closest<HTMLDetailsElement>('details.lift-fold') ?? null
  ) {
    if (!fold.open) fold.open = true;
  }
}

function idFromHash(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return '';
  }
}

/**
 * On a phone each card of the case rail is one closed row. Most browsers open a closed row by
 * themselves when a link points at something inside it; this does the same for the ones that do
 * not, for the address the page opened with, a changed address, and a click on a link to a place
 * on this same page (which raises no change event when the address already ends with that
 * anchor). Only rail folds are touched, and nothing happens without script: the row still opens
 * by hand. It draws nothing.
 */
export function OpenFoldOnLink() {
  useEffect(() => {
    const onHash = () => openFoldsAround(idFromHash(window.location.hash));
    const onClick = (event: MouseEvent) => {
      const href = (event.target as Element | null)
        ?.closest?.('a[href*="#"]')
        ?.getAttribute('href');
      if (!href) return;
      let to: URL;
      try {
        to = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (to.origin !== window.location.origin || to.pathname !== window.location.pathname) return;
      openFoldsAround(idFromHash(to.hash));
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return null;
}
