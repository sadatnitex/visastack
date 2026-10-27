'use client';

import { type RefObject, useEffect, useSyncExternalStore } from 'react';

/**
 * Close a disclosure (`<details>`) when a press lands anywhere outside it, as the account menu, the
 * phone context chip, the More sheet and the lists beside the sidebar rail all do, so two menus
 * never sit open together. Does nothing while `enabled` is false.
 */
export function useCloseOnOutsidePress(
  ref: RefObject<HTMLDetailsElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const outside = (event: PointerEvent) => {
      const details = ref.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [ref, enabled]);
}

/**
 * Whether a media query matches right now, following it as the window changes. False while the
 * page is first drawn on the server, so the first client render always agrees with the HTML.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}
