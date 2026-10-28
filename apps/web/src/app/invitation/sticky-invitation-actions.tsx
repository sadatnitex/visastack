'use client';

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** Where the pinned copy can show: the same width as its rule in globals.css (WP-UXG). */
export const PINNED_ACTIONS_QUERY = '(max-width: 640px)';
const FOCUSABLE = 'a[href], button';
/** Fully on screen, allowing for rounding in the browser's sums. */
const FULLY_VISIBLE = 0.99;

/**
 * The invitation's main buttons at the top of the page and, on phones, a copy pinned to the bottom
 * of the screen once the top ones are no longer fully in view below the sticky site header.
 *
 * Exactly one copy is ever usable: the hidden one is `inert` (out of sight, speech and keyboard),
 * and focus on it moves to the same button in the other copy when it hides, whether that happens by
 * scrolling or by the screen growing past the phone width. Without scripts, or where the browser
 * cannot watch, only the top buttons exist and the page works as before.
 */
export function StickyInvitationActions({ children }: { readonly children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const [watching, setWatching] = useState(false);
  const [topInView, setTopInView] = useState(true);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const top = topRef.current;
    if (
      !top ||
      typeof IntersectionObserver !== 'function' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const media = window.matchMedia(PINNED_ACTIONS_QUERY);
    // Each change is applied at once, so focus can move before the copy it is on turns inert.
    const observer = new IntersectionObserver(
      (entries) => {
        const latest = entries[entries.length - 1];
        if (!latest) return;
        const fully = latest.isIntersecting && latest.intersectionRatio >= FULLY_VISIBLE;
        flushSync(() => setTopInView(fully));
      },
      { rootMargin: `-${stickyHeaderInset()}px 0px 0px 0px`, threshold: [0, 1] },
    );
    const onWidth = (event: MediaQueryListEvent) => flushSync(() => setNarrow(event.matches));
    setNarrow(media.matches);
    media.addEventListener('change', onWidth);
    observer.observe(top);
    setWatching(true);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', onWidth);
    };
  }, []);

  const pinnedShown = watching && narrow && !topInView;

  // The copy that has just hidden hands any focus on it to the same button in the copy now shown.
  useLayoutEffect(() => {
    const hidden = pinnedShown ? topRef.current : pinnedRef.current;
    const shown = pinnedShown ? pinnedRef.current : topRef.current;
    const focused = document.activeElement;
    if (!hidden || !shown || !(focused instanceof HTMLElement) || !hidden.contains(focused)) return;
    const index = [...hidden.querySelectorAll(FOCUSABLE)].indexOf(focused);
    shown.querySelectorAll<HTMLElement>(FOCUSABLE)[index]?.focus({ preventScroll: true });
  }, [pinnedShown]);

  return (
    <>
      <div
        ref={topRef}
        className="invitation-actions"
        data-pinned={pinnedShown ? 'true' : undefined}
        inert={pinnedShown}
      >
        {children}
      </div>
      {watching ? (
        <div
          ref={pinnedRef}
          className="invitation-sticky"
          data-shown={pinnedShown ? 'true' : 'false'}
          inert={!pinnedShown}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}

/**
 * How far the sticky site header reaches down the screen (its offset from the top plus its own
 * height), read once: buttons behind it are not in view, even though they are inside the window.
 */
function stickyHeaderInset(): number {
  const header = document.querySelector('header.nav');
  if (!(header instanceof HTMLElement)) return 0;
  const style = getComputedStyle(header);
  if (style.position !== 'sticky' && style.position !== 'fixed') return 0;
  const offset = Number.parseFloat(style.top);
  return Math.ceil((Number.isFinite(offset) ? offset : 0) + header.getBoundingClientRect().height);
}
