'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { PublicButton } from './public-button';

/**
 * Phone helpers for the Home page (MOB1, 19 Nov 2026). Each one does nothing on a computer: the
 * styles that show them live in `home-story.css` inside `max-width: 759px` rules, so a computer
 * draws exactly what it drew before.
 */

export interface PhoneActionBarProps {
  /** The chapter the bar waits behind: it appears once this chapter has scrolled off the top. */
  readonly afterId: string;
  /** The closing chapter: the bar leaves as it comes into view, so it never covers it or the footer. */
  readonly beforeId: string;
  readonly href: string;
  /** The page's own main button label (today's words, which follow sign-in and beta state). */
  readonly children: ReactNode;
}

/**
 * The one main action, pinned to the bottom of a phone after the first screen and through the
 * chapters that follow, gone again for the closing call and the footer. Without script it never
 * shows (the first and last chapters carry the same button). The reading order is unchanged: the
 * bar sits last inside the page and is out of the tab order while it is hidden.
 */
export function PhoneActionBar({ afterId, beforeId, href, children }: PhoneActionBarProps) {
  const [shown, setShown] = useState(false);
  const [mounted, setMounted] = useState(false);

  // The bar is drawn only once the page runs in the browser: the server's page carries the main
  // button once in the first chapter and once in the closing one, as it always did.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const after = document.getElementById(afterId);
    const before = document.getElementById(beforeId);
    if (!after || !before || typeof IntersectionObserver === 'undefined') return;
    let past = false;
    let reached = false;
    const update = () => setShown(past && !reached);
    const watchAfter = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      past = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
      update();
    });
    // Leaves a little before the closing chapter arrives, so the last button of the chapter above
    // is never left under the bar.
    const watchBefore = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        reached = entry.isIntersecting || entry.boundingClientRect.top < 0;
        update();
      },
      { rootMargin: '0px 0px 80px 0px' },
    );
    watchAfter.observe(after);
    watchBefore.observe(before);
    return () => {
      watchAfter.disconnect();
      watchBefore.disconnect();
    };
  }, [afterId, beforeId, mounted]);

  if (!mounted) return null;
  return (
    <div className="hs-bar" data-shown={shown ? 'true' : 'false'}>
      <PublicButton href={href} variant="primary">
        {children}
      </PublicButton>
    </div>
  );
}

export interface PhoneMoreProps {
  /** The finished picture; on a phone its first four rows show. */
  readonly children: ReactNode;
  /** The button words while the rest is hidden, for example `See All 8`. */
  readonly seeAll: ReactNode;
  /** The button words once everything shows. */
  readonly fewer: ReactNode;
}

/**
 * Shows four rows and a button that opens the rest in place. The rows are hidden only after the page
 * has started in the browser, so without script a phone still shows everything and the button (which
 * would do nothing) never appears.
 */
export function PhoneMore({ children, seeAll, fewer }: PhoneMoreProps) {
  const bodyId = useId();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className="hs-more" {...(ready ? { 'data-ready': '' } : {})} data-open={open}>
      <div className="hs-more-body" id={bodyId}>
        {children}
      </div>
      <button
        type="button"
        className="pub-button pub-button-secondary hs-more-button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? fewer : seeAll}
      </button>
    </div>
  );
}

/**
 * A row that swipes sideways on a phone. When it really scrolls it becomes a focus stop, so the
 * arrow keys reach every card; where nothing overflows (a computer) it adds no tab stop.
 */
export function SwipeRow({
  labelledBy,
  children,
}: { readonly labelledBy: string; readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const check = () => setScrolls(row.scrollWidth > row.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(check);
    watch.observe(row);
    return () => watch.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="hs-swipe"
      {...(scrolls
        ? {
            role: 'group' as const,
            'aria-labelledby': labelledBy,
            tabIndex: 0,
          }
        : {})}
    >
      {children}
    </div>
  );
}
