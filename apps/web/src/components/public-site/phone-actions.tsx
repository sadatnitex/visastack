'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { PublicButton } from './public-button';

/**
 * Phone helpers for the Home page (MOB1, 19 Nov 2026). Each one does nothing on a computer: the
 * styles that show them live in `home-story.css` inside `max-width: 759px` rules, so a computer
 * draws exactly what it drew before.
 */

/** Used when the header cannot be measured (it is 56 to 64 px high on a phone). */
const FALLBACK_HEADER_OFFSET = 72;

/** Where the sticky header ends, measured: its own height plus the gap it keeps from the top. */
function headerOffset(): number {
  const header = document.querySelector('header.nav');
  if (!(header instanceof HTMLElement)) return FALLBACK_HEADER_OFFSET;
  const top = Number.parseFloat(getComputedStyle(header).top) || 0;
  return Math.ceil(top + header.offsetHeight) || FALLBACK_HEADER_OFFSET;
}

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
    const offset = headerOffset();
    const watchAfter = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        // The position decides, not isIntersecting: edge to edge counts as on screen for the observer.
        past = entry.boundingClientRect.bottom <= offset;
        update();
      },
      // The hero counts as gone once its bottom edge is under the sticky header, which is where a
      // link to the next chapter lands it.
      { rootMargin: `-${offset}px 0px 0px 0px` },
    );
    // Leaves as the closing chapter comes into view (and stays gone through the footer).
    const watchBefore = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      reached = entry.isIntersecting || entry.boundingClientRect.top < 0;
      update();
    });
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
    // The row is a plain wrapper from 760 px up (display: contents, so it has no size to watch): the
    // media query tells it when the window crosses that line in either direction.
    const phone =
      typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 759px)') : null;
    const check = () =>
      setScrolls((phone?.matches ?? true) && row.scrollWidth > row.clientWidth + 1);
    check();
    phone?.addEventListener('change', check);
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    watch?.observe(row);
    return () => {
      phone?.removeEventListener('change', check);
      watch?.disconnect();
    };
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
