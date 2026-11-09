'use client';

import { type RefObject, useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * The behaviour every panel shares, whichever screen draws it. While `open`: Escape closes it
 * (unless a menu or question inside already used the key). While `trap` (the panel is a full
 * screen of its own): the page behind it does not scroll and Tab stays inside it. When the panel
 * opens and `shouldFocus` says so, it takes focus, so a keyboard or screen reader person is in it.
 */
export function useSheetBehaviour({
  open,
  trap,
  panel,
  onClose,
  shouldFocus = () => true,
  focusKey = open,
}: {
  readonly open: boolean;
  readonly trap: boolean;
  readonly panel: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  /** Asked each time the panel opens or its `focusKey` changes: whether it takes focus now. */
  readonly shouldFocus?: () => boolean;
  /** What the panel shows (the chosen item): when it changes while open, the panel is asked again. */
  readonly focusKey?: unknown;
}): void {
  const close = useRef(onClose);
  close.current = onClose;
  const focus = useRef(shouldFocus);
  focus.current = shouldFocus;
  // Focus follows what the panel shows, not the width of the window: a resize never pulls focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the shown item changes
  useEffect(() => {
    if (open && focus.current()) panel.current?.focus();
  }, [open, focusKey, panel]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    if (trap) document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !trap) return;
      const el = panel.current;
      if (!el) return;
      const focusable = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!el.contains(active) || active === el) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, trap, panel]);
}
