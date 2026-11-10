'use client';

import { useEffect } from 'react';

const REQUEST_HASH = /^#request-(.+)$/;

/**
 * An email, a notice or a search result links to `#request-<id>`. The row is on the page, so the
 * browser scrolls to it; this also opens that request's panel, the way a click on its name does,
 * so the person lands on the conversation and the reply.
 * - On load it follows the address, unless the address already names a request with `?item=`:
 *   that explicit choice wins over a hash left behind by an earlier link.
 * - Afterwards it follows the hash when it changes, and a click on a link to a request on this
 *   same page (search results move through the router, so no hash change is announced).
 * It does nothing for a request that is not on the page.
 */
export function OpenRequestFromHash() {
  useEffect(() => {
    const openRequest = (id: string | undefined) => {
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
      // Already open: leave it, so a repeated address never toggles anything.
      if (link.getAttribute('aria-current') === 'true') return;
      link.click();
    };
    const fromHash = () => openRequest(window.location.hash.match(REQUEST_HASH)?.[1]);
    if (!new URLSearchParams(window.location.search).has('item')) fromHash();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href*="#request-"]');
      const href = link?.getAttribute('href');
      if (!href) return;
      let to: URL;
      try {
        to = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (to.origin !== window.location.origin || to.pathname !== window.location.pathname) return;
      const id = to.hash.match(REQUEST_HASH)?.[1];
      // Let the router finish its own move first, then open what the address names.
      clearTimeout(timer);
      timer = setTimeout(() => openRequest(id), 150);
    };
    window.addEventListener('hashchange', fromHash);
    document.addEventListener('click', onClick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('hashchange', fromHash);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return null;
}
