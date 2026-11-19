'use client';

import { useEffect } from 'react';

/**
 * Put once on a page whose rows are folded: when the address names one of them (`#delete-account`),
 * on arrival and whenever the address changes, the fold that holds it opens and scrolls into
 * view. A link to a section is only useful if what it points at can be seen.
 */
export function OpenRowOnLink() {
  useEffect(() => {
    const openNamed = () => {
      let id = '';
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      // The fold the target sits in, or the fold the target itself is the card of.
      const fold = target.closest('details') ?? target.querySelector(':scope details');
      if (fold && !fold.open) fold.open = true;
      target.scrollIntoView?.({ block: 'start' });
    };
    openNamed();
    window.addEventListener('hashchange', openNamed);
    return () => window.removeEventListener('hashchange', openNamed);
  }, []);
  return null;
}
