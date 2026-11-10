'use client';

import { useEffect } from 'react';

/** The address fragment that has always meant "the new sharing request form" (the Record's Share link, bookmarks). */
const COMPOSER_HASH = '#new-sharing-request';

/**
 * Opens the new sharing request panel when the address ends in `#new-sharing-request`, as links
 * from the Record's Share action and from older bookmarks do. The panel is the list pattern's, so
 * this only presses the same button a person would press; it draws nothing. The press waits one
 * turn of the browser, because the list attaches its click handling after its children have run
 * (an earlier press would be followed as a plain link and reload the page, dropping the document
 * chosen on the Record). A panel that is already open (the address named the document) is left be.
 */
export function OpenComposerFromHash() {
  useEffect(() => {
    if (window.location.hash !== COMPOSER_HASH) return;
    const timer = window.setTimeout(() => {
      const open = document.querySelector('#lp-pane-new:not([hidden])');
      if (open) return;
      document.querySelector<HTMLElement>('a[data-pane-open="new"]')?.click();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
