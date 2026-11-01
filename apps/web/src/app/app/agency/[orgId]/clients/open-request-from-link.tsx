'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

const ANCHOR = /^#request-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The address that shows one linked request (WP-SB5), or null. Do Next and the workspace search
 * link to `#request-<id>`; the list shows 15 requests at a time, so when the linked one is not on
 * the page, `?request=<id>` asks the server to show it first. The server shows it only when it is
 * one of this organization's requests.
 */
export function openRequestAddress(
  pathname: string,
  search: string,
  hash: string,
  onPage: (elementId: string) => boolean,
): string | null {
  const match = hash.match(ANCHOR);
  if (!match?.[1]) return null;
  const params = new URLSearchParams(search);
  if (params.has('request')) return null;
  const id = match[1].toLowerCase();
  if (onPage(`request-${id}`)) return null;
  params.set('request', id);
  return `${pathname}?${params.toString()}#request-${id}`;
}

/** Shows a linked request that is not on this page of the list. */
export function OpenRequestFromLink() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const check = () => {
      const target = openRequestAddress(
        pathname,
        window.location.search,
        window.location.hash,
        (elementId) => document.getElementById(elementId) !== null,
      );
      if (target) router.replace(target);
    };
    // A link that only changes the anchor on this page loads nothing by itself.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== pathname) return;
      const target = openRequestAddress(
        url.pathname,
        url.search,
        url.hash,
        (elementId) => document.getElementById(elementId) !== null,
      );
      if (!target) return;
      event.preventDefault();
      router.push(target);
    };
    check();
    window.addEventListener('hashchange', check);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('hashchange', check);
      document.removeEventListener('click', onClick, true);
    };
  }, [pathname, router]);
  return null;
}
