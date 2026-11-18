'use client';

import { useEffect, useRef } from 'react';

/**
 * Opens every closed section around it when the address points at `hash` (on load and when the
 * address changes), then brings the target into view. A link such as `#safe-copy-<document>`
 * lands inside a section that starts closed (WAL2); the browser cannot scroll to something folded
 * away, so the section opens first. Draws nothing.
 */
export function OpenOnHash({ hash }: { readonly hash: `#${string}` }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const open = () => {
      if (window.location.hash !== hash) return;
      for (let el = marker.current?.parentElement; el; el = el.parentElement) {
        if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
      }
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [hash]);
  return <span ref={marker} hidden />;
}
