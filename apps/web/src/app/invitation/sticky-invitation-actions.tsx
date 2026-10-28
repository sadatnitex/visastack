'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * The invitation's main buttons at the top of the page, and the same buttons pinned to the bottom
 * of a phone screen once the top ones have scrolled out of view (the stylesheet shows the pinned
 * copy on narrow screens only).
 *
 * Without scripts, or where the browser cannot watch the buttons, only the top buttons exist and
 * the page works as before. While the top buttons are on screen the pinned copy is hidden from
 * sight, from screen readers and from the keyboard, so a person never meets the same buttons twice.
 */
export function StickyInvitationActions({ children }: { readonly children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const [watching, setWatching] = useState(false);
  const [topInView, setTopInView] = useState(true);

  useEffect(() => {
    const top = topRef.current;
    if (!top || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1];
      if (!latest) return;
      // Before the pinned copy hides under a keyboard user, focus moves to the same button at the
      // top, so it is never lost when the copy turns inert.
      if (latest.isIntersecting) moveFocusToTop(pinnedRef.current, top);
      setTopInView(latest.isIntersecting);
    });
    observer.observe(top);
    setWatching(true);
    return () => observer.disconnect();
  }, []);

  const pinnedShown = watching && !topInView;

  return (
    <>
      <div ref={topRef} className="invitation-actions">
        {children}
      </div>
      {watching ? (
        <div
          ref={pinnedRef}
          className="invitation-sticky"
          data-shown={pinnedShown ? 'true' : 'false'}
          aria-hidden={pinnedShown ? undefined : true}
          inert={!pinnedShown}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}

function moveFocusToTop(pinned: HTMLElement | null, top: HTMLElement) {
  const focused = document.activeElement;
  if (!pinned || !(focused instanceof HTMLElement) || !pinned.contains(focused)) return;
  const index = [...pinned.querySelectorAll('a, button')].indexOf(focused);
  top.querySelectorAll<HTMLElement>('a, button')[index]?.focus({ preventScroll: true });
}
