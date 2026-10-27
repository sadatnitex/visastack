/**
 * Where a popover opens so it always fits the screen: beside its trigger, on the side with room,
 * never taller than the space it has, never more than a set share of the window, never closer than
 * a margin to any edge. Pure arithmetic over measured boxes, so
 * the rules are unit-tested here and the component only measures and applies the answer.
 */

export interface TriggerBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface PopoverPlacement {
  /** Opens under the trigger, or above it when the trigger sits low and there is more room above. */
  readonly placement: 'below' | 'above';
  /** `end` lines the popover's right edge with the trigger's; `start` lines the left edges. */
  readonly align: 'end' | 'start';
  /** The tallest the popover may be, in pixels: the room, and no more than the share allowed. */
  readonly maxHeight: number;
}

/** A popover is never squeezed below this, so a very short window still shows a few rows. */
export const MIN_POPOVER_HEIGHT = 120;

/** A popover never fills the window: at most this share of its height, however much room there is. */
export const MAX_POPOVER_SHARE = 0.7;

/** Room kept between a popover and the screen edge, so it never touches the bottom or a side. */
export const POPOVER_EDGE_MARGIN = 16;

export function placePopover({
  trigger,
  viewport,
  contentHeight,
  width,
  gap = 8,
  margin = POPOVER_EDGE_MARGIN,
  maxShare = MAX_POPOVER_SHARE,
}: {
  readonly trigger: TriggerBox;
  readonly viewport: { readonly width: number; readonly height: number };
  /** The full height the content wants, borders included, before any limit. */
  readonly contentHeight: number;
  readonly width: number;
  /** Space between the trigger and the popover. */
  readonly gap?: number;
  /** Space kept between the popover and the screen edge. */
  readonly margin?: number;
  /** The most of the window's height the popover may take, as a fraction (0.7 is 70 percent). */
  readonly maxShare?: number;
}): PopoverPlacement {
  const below = viewport.height - trigger.bottom - gap - margin;
  const above = trigger.top - gap - margin;
  const share = viewport.height * maxShare;
  // Prefer below; open above only when the content (at most the share) does not fit below and above
  // has more room.
  const placement = Math.min(contentHeight, share) <= below || below >= above ? 'below' : 'above';
  const space = placement === 'below' ? below : above;
  const maxHeight = Math.max(MIN_POPOVER_HEIGHT, Math.floor(Math.min(space, share)));

  // Prefer the popover growing leftwards from the trigger's right edge, as the account menu does.
  const overflowEnd = Math.max(0, margin - (trigger.right - width));
  const overflowStart = Math.max(0, trigger.left + width - (viewport.width - margin));
  const align = overflowEnd <= overflowStart ? 'end' : 'start';
  return { placement, align, maxHeight };
}
