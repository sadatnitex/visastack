'use client';

import {
  type FocusEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { POPOVER_EDGE_MARGIN, type PopoverPlacement, placePopover } from './popover-placement';

/**
 * The behaviour behind an Explain popup (`components/explain-tip.tsx`): a small picture or symbol
 * that, when someone points at it, focuses it or taps it, shows its name and one plain sentence.
 *
 * - Pointer hover opens it after a short pause, so a pointer passing over the page does not flash
 *   popups; leaving closes it after a shorter pause, long enough to cross the gap onto the popup,
 *   which keeps it open (the hover bridge).
 * - Keyboard focus opens it at once; moving focus away closes it.
 * - A tap or click opens it and a second one closes it, so a touch screen reaches the same words.
 * - Escape and a press anywhere outside close it.
 * - Only one is open on the page at a time: opening one closes the last.
 *
 * Where it opens comes from `placePopover`, the same rule the account menu uses, plus a sideways
 * shift that keeps it inside a narrow (320 px) screen.
 */

/** Pause before a hovering pointer opens the popup, in milliseconds. */
export const EXPLAIN_OPEN_DELAY = 300;
/** Pause before a pointer that left closes it, long enough to cross onto the popup. */
export const EXPLAIN_CLOSE_DELAY = 150;
/** Space between the trigger and the popup, in pixels (the stylesheet draws the same gap). */
export const EXPLAIN_GAP = 8;

/** Closes whichever popup is open now; only one is open at a time across the page. */
let closeOpenTip: (() => void) | null = null;

export interface ExplainFit extends PopoverPlacement {
  /** Pixels to move the popup sideways (right is positive) so no edge leaves the screen. */
  readonly shift: number;
}

/**
 * How far to slide a popup sideways so it stays inside the screen, given where its aligned edge
 * would put it. Pure, so the rule is unit-tested; the popup is never wider than the screen allows.
 */
export function shiftIntoView({
  left,
  width,
  viewportWidth,
  margin = POPOVER_EDGE_MARGIN,
}: {
  /** Where the popup's left edge would sit, in pixels from the left of the screen. */
  readonly left: number;
  readonly width: number;
  readonly viewportWidth: number;
  readonly margin?: number;
}): number {
  const overRight = left + width - (viewportWidth - margin);
  if (overRight > 0) return Math.max(margin - left, -overRight);
  if (left < margin) return margin - left;
  return 0;
}

export interface ExplainTipState {
  readonly open: boolean;
  readonly fit: ExplainFit | null;
  readonly popupId: string;
  readonly wrapRef: RefObject<HTMLSpanElement | null>;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly popupRef: RefObject<HTMLSpanElement | null>;
  /** Handlers for the element that holds both the trigger and the popup. */
  readonly wrapProps: {
    readonly onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
    readonly onBlur: (event: FocusEvent<HTMLElement>) => void;
    readonly onPointerDown: () => void;
  };
  /** Handlers for the trigger button. */
  readonly triggerProps: {
    readonly onPointerDown: () => void;
    readonly onFocus: () => void;
    readonly onClick: () => void;
  };
  readonly close: () => void;
}

/** Only a mouse or pen hovers; a finger's "enter" is part of a tap, which the click handles. */
const hovers = (event: PointerEvent<HTMLElement>) =>
  event.pointerType === 'mouse' || event.pointerType === 'pen';

export function useExplainTip({
  openDelay = EXPLAIN_OPEN_DELAY,
  closeDelay = EXPLAIN_CLOSE_DELAY,
}: { readonly openDelay?: number; readonly closeDelay?: number } = {}): ExplainTipState {
  const popupId = `explain-${useId()}`;
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [fit, setFit] = useState<ExplainFit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set by a press on the trigger, so the focus that press brings does not open the popup before
  // the click decides (a click on a closed popup opens it; on an open one, closes it).
  const pressing = useRef(false);
  // Set by any press inside the holder, so the blur that press causes (focus moving from the
  // trigger to the page) does not close a popup someone is pressing on to read or select.
  const pressInside = useRef(false);
  // How it was opened. A popup a press opened stays until a second press, Escape or a press
  // outside: the pointer leaving does not close it (a pen lifting, a mouse moving on after a click).
  const how = useRef<'hover' | 'focus' | 'press' | null>(null);
  // Ends the current press. Both press marks are cleared wherever the press ends, on the page
  // or not at all (the browser cancels it for a scroll), so a drag that starts here and lifts
  // elsewhere never leaves the popup held open or the next keyboard focus unable to open it.
  const endPress = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimer();
    how.current = null;
    setOpen(false);
  }, [clearTimer]);

  const show = useCallback(
    (by: 'hover' | 'focus' | 'press') => {
      clearTimer();
      if (closeOpenTip && closeOpenTip !== close) closeOpenTip();
      closeOpenTip = close;
      how.current = by;
      setOpen(true);
    },
    [clearTimer, close],
  );

  const startPress = useCallback(() => {
    pressInside.current = true;
    if (endPress.current) return;
    const end = () => {
      pressing.current = false;
      pressInside.current = false;
      document.removeEventListener('pointerup', end, { capture: true });
      document.removeEventListener('pointercancel', end, { capture: true });
      endPress.current = null;
    };
    document.addEventListener('pointerup', end, { capture: true });
    document.addEventListener('pointercancel', end, { capture: true });
    endPress.current = end;
  }, []);

  // Forget this popup as "the open one" once it closes or leaves the page.
  useEffect(() => {
    if (!open && closeOpenTip === close) closeOpenTip = null;
  }, [open, close]);
  useEffect(
    () => () => {
      clearTimer();
      endPress.current?.();
      if (closeOpenTip === close) closeOpenTip = null;
    },
    [clearTimer, close],
  );

  // While open: Escape closes it, and so does a press anywhere outside it. Escape is heard first
  // (capture), and when focus is on the trigger it goes no further, so a menu or dialog around the
  // popup stays open: one Escape closes one thing.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      const wrap = wrapRef.current;
      if (wrap && event.target instanceof Node && wrap.contains(event.target)) {
        event.stopPropagation();
      }
    };
    const onPress = (event: globalThis.PointerEvent) => {
      const wrap = wrapRef.current;
      if (wrap && event.target instanceof Node && !wrap.contains(event.target)) close();
    };
    document.addEventListener('keydown', onKey, { capture: true });
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true });
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open, close]);

  // Measure where it fits each time it opens, and again while open if the window moves under it.
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;
    const box = trigger.getBoundingClientRect();
    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const width = popup.offsetWidth;
    const placed = placePopover({
      trigger: box,
      viewport,
      contentHeight: popup.scrollHeight,
      width,
      gap: EXPLAIN_GAP,
    });
    const left = placed.align === 'end' ? box.right - width : box.left;
    const shift =
      viewport.width > 0 ? shiftIntoView({ left, width, viewportWidth: viewport.width }) : 0;
    // Only a real change re-draws, so scrolling with the popup open does not re-render every frame.
    setFit((last) =>
      last &&
      last.placement === placed.placement &&
      last.align === placed.align &&
      last.maxHeight === placed.maxHeight &&
      last.shift === shift
        ? last
        : { ...placed, shift },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setFit(null);
      return;
    }
    place();
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener('resize', again);
    document.addEventListener('scroll', again, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', again);
      document.removeEventListener('scroll', again, { capture: true });
    };
  }, [open, place]);

  // The sideways shift and the height limit are written straight onto the holder as custom
  // properties the stylesheet reads (as the account menu does), never as an inline style prop.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (fit) {
      wrap.style.setProperty('--explain-tip-shift', `${fit.shift}px`);
      wrap.style.setProperty('--explain-tip-max-height', `${fit.maxHeight}px`);
    } else {
      wrap.style.removeProperty('--explain-tip-shift');
      wrap.style.removeProperty('--explain-tip-max-height');
    }
  }, [fit]);

  const onPointerEnter = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!hovers(event)) return;
      clearTimer();
      if (open) return;
      timer.current = setTimeout(() => show('hover'), openDelay);
    },
    [clearTimer, open, show, openDelay],
  );

  const onPointerLeave = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!hovers(event)) return;
      clearTimer();
      // Keep it open while the trigger holds keyboard focus (the person may still be reading), and
      // when a press opened it.
      if (!open || how.current === 'press' || wrapRef.current?.contains(document.activeElement)) {
        return;
      }
      timer.current = setTimeout(close, closeDelay);
    },
    [clearTimer, open, close, closeDelay],
  );

  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      pressing.current = false;
      if (pressInside.current) {
        pressInside.current = false;
        return;
      }
      if (next instanceof Node && wrapRef.current?.contains(next)) return;
      close();
    },
    [close],
  );

  const triggerProps = {
    onPointerDown: () => {
      pressing.current = true;
    },
    onFocus: () => {
      if (pressing.current || open) return;
      show('focus');
    },
    // A press on a popup that a press opened closes it; a press on one that hover or focus opened
    // keeps it, so resting on the icon and then clicking it never shuts what was asked for.
    onClick: () => {
      pressing.current = false;
      if (open && how.current === 'press') close();
      else show('press');
    },
  };

  return {
    open,
    fit,
    popupId,
    wrapRef,
    triggerRef,
    popupRef,
    wrapProps: {
      onPointerEnter,
      onPointerLeave,
      onBlur,
      onPointerDown: startPress,
    },
    triggerProps,
    close,
  };
}
