/**
 * Safe copy boxes (ADR 0022, S23): the shared rules for the black boxes a record owner places on
 * a page. Used by the editor in the browser, the service that saves them and the renderer that
 * paints them, so all three agree on what a box is.
 *
 * A box is a rectangle in fractions of the page: `x` and `y` are the top-left corner measured
 * from the page's top-left, `w` and `h` its width and height, all between 0 and 1. Fractions keep
 * a box in the same place whatever size the page is drawn at.
 */

export interface RedactionBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const REDACTION_LIMITS = Object.freeze({
  /** Pages a safe copy can have. */
  maxPages: 20,
  /** Boxes on one page. */
  maxBoxesPerPage: 200,
  /** The smallest side a box may have, as a fraction of the page (about 1 pixel on a phone). */
  minSide: 0.002,
  /** Largest stored file a safe copy is made from: 25 MB. */
  maxInputBytes: 25 * 1024 * 1024,
  /** Time allowed for one safe copy, in milliseconds. */
  renderBudgetMs: 30_000,
});

/** Stored values are kept to six decimal places, far finer than any pixel. */
const PRECISION = 1_000_000;

/** Tolerance for values that are 1 or 0 apart from floating point noise. */
const EPSILON = 1e-9;

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -EPSILON;
}

/**
 * A box from untrusted input, or undefined when it is not a valid box: every value a finite
 * number, the corner inside the page, both sides at least `minSide`, and the far edges no further
 * than the page's edge. Never clamps a bad value into a good one: a box the person did not draw
 * is never saved.
 */
export function parseRedactionBox(input: unknown): RedactionBox | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const { x, y, w, h } = input as Record<string, unknown>;
  if (!isFraction(x) || !isFraction(y) || !isFraction(w) || !isFraction(h)) return undefined;
  if (w < REDACTION_LIMITS.minSide || h < REDACTION_LIMITS.minSide) return undefined;
  if (x + w > 1 + EPSILON || y + h > 1 + EPSILON) return undefined;
  const box = {
    x: round(Math.max(0, x)),
    y: round(Math.max(0, y)),
    w: round(w),
    h: round(h),
  };
  // Rounding never pushes a box past the edge.
  const kept = {
    x: box.x,
    y: box.y,
    w: Math.min(box.w, round(1 - box.x)),
    h: Math.min(box.h, round(1 - box.y)),
  };
  if (kept.w < REDACTION_LIMITS.minSide || kept.h < REDACTION_LIMITS.minSide) return undefined;
  return kept;
}

/** The largest stored value not above `value`, so a far edge never rounds past the page. */
function roundDown(value: number): number {
  // The small nudge absorbs floating point noise such as (1 - 0.3) * 1e6 = 699999.9999999.
  return Math.floor(value * PRECISION + 1e-6) / PRECISION;
}

/**
 * A box kept inside the page with sides no smaller than `minSide`, for the editor's moves and
 * drawing. Sizes are rounded first and the corner is then kept within what is left, rounded
 * down, so the result is always one `parseRedactionBox` accepts.
 */
export function clampRedactionBox(box: RedactionBox): RedactionBox {
  const min = REDACTION_LIMITS.minSide;
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  const w = round(Math.min(1, Math.max(min, finite(box.w, min))));
  const h = round(Math.min(1, Math.max(min, finite(box.h, min))));
  const x = Math.min(roundDown(1 - w), Math.max(0, round(finite(box.x, 0))));
  const y = Math.min(roundDown(1 - h), Math.max(0, round(finite(box.y, 0))));
  return { x, y, w, h };
}

/** The box moved by a step, staying on the page. */
export function moveRedactionBox(box: RedactionBox, dx: number, dy: number): RedactionBox {
  return clampRedactionBox({ ...box, x: box.x + dx, y: box.y + dy });
}

/** The box made wider or taller (or narrower or shorter) from its top-left corner. */
export function resizeRedactionBox(box: RedactionBox, dw: number, dh: number): RedactionBox {
  const min = REDACTION_LIMITS.minSide;
  const w = Math.min(1 - box.x, Math.max(min, box.w + dw));
  const h = Math.min(1 - box.y, Math.max(min, box.h + dh));
  return clampRedactionBox({ ...box, w, h });
}

/** A box widened by `pad` on every side and kept on the page: suggestions err on hiding more. */
export function padRedactionBox(box: RedactionBox, padX: number, padY: number): RedactionBox {
  const x0 = Math.max(0, box.x - padX);
  const y0 = Math.max(0, box.y - padY);
  const x1 = Math.min(1, box.x + box.w + padX);
  const y1 = Math.min(1, box.y + box.h + padY);
  return clampRedactionBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

export interface PixelRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The pixels a box covers on a page drawn `width` by `height`, rounded outwards (a partly covered
 * pixel is covered) and widened by `padPx` on every side, never past the page.
 */
export function redactionPixelRect(
  box: RedactionBox,
  width: number,
  height: number,
  padPx: number,
): PixelRect {
  const left = Math.max(0, Math.floor(box.x * width) - padPx);
  const top = Math.max(0, Math.floor(box.y * height) - padPx);
  const right = Math.min(width, Math.ceil((box.x + box.w) * width) + padPx);
  const bottom = Math.min(height, Math.ceil((box.y + box.h) * height) + padPx);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function percent(value: number): number {
  return Math.round(value * 100);
}

/** A plain sentence that says where a box is, for people who cannot see the page. */
export function describeRedactionBox(box: RedactionBox): string {
  return `${percent(box.x)}% from the left, ${percent(box.y)}% from the top, ${percent(box.w)}% wide and ${percent(box.h)}% tall`;
}
