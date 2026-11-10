'use client';

import { useEffect } from 'react';

/** The address fragment that has always meant "the new sharing request form" (the Record's Share link, bookmarks). */
const COMPOSER_HASH = '#new-sharing-request';

/**
 * Opens the new sharing request panel when the address ends in `#new-sharing-request`, as links
 * from the Record's Share action and from older bookmarks do. The panel is the list pattern's, so
 * this only presses the same button a person would press; it draws nothing.
 */
export function OpenComposerFromHash() {
  useEffect(() => {
    if (window.location.hash !== COMPOSER_HASH) return;
    document.querySelector<HTMLElement>('a[data-pane-open="new"]')?.click();
  }, []);
  return null;
}
