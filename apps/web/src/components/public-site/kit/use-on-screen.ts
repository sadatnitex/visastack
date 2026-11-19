'use client';

import { type RefObject, useEffect, useState } from 'react';

/**
 * True while the element is on screen AND the tab is showing, so a loop can stop whenever nobody
 * can see it (MOT1: motion runs for every visitor but never off screen or in a hidden tab). Watching
 * starts once `enabled` is true. Where the browser has no IntersectionObserver the element counts as
 * on screen, so older browsers keep the plain loop. The newest observer entry decides.
 */
export function useOnScreen(ref: RefObject<Element | null>, enabled: boolean): boolean {
  const [onScreen, setOnScreen] = useState(true);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    const watcher =
      element && typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) =>
            setOnScreen(entries[entries.length - 1]?.isIntersecting ?? false),
          )
        : null;
    if (element) watcher?.observe(element);
    const visibility = () => setShown(!document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      watcher?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [ref, enabled]);
  return onScreen && shown;
}
