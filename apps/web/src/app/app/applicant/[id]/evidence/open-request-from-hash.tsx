'use client';

import { useEffect } from 'react';

/**
 * An email or notice links to `#request-<id>`. The row is on the page, so the browser scrolls to it;
 * this also opens that request's panel, the way a click on its name does, so the person lands on the
 * conversation and the reply. It runs on load and when the address changes, and does nothing for a
 * request that is not on the page.
 */
export function OpenRequestFromHash() {
  useEffect(() => {
    const open = () => {
      const match = window.location.hash.match(/^#request-(.+)$/);
      const id = match?.[1];
      if (!id) return;
      const link = [...document.querySelectorAll<HTMLAnchorElement>('a[data-pane-open]')].find(
        (candidate) => candidate.getAttribute('data-pane-open') === id,
      );
      if (!link) return;
      // The folder the row is in may be closed; open it so the row is on screen.
      for (
        let folder = link.closest('details');
        folder;
        folder = folder.parentElement?.closest('details') ?? null
      ) {
        folder.open = true;
      }
      // Already open: leave it, so a second hashchange never toggles anything.
      if (link.getAttribute('aria-current') === 'true') return;
      link.click();
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  return null;
}
