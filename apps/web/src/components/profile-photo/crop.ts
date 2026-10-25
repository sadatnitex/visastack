/**
 * Square crop geometry for profile photos (WP-PH1). Pure functions, so the
 * rules are tested without a browser: the photo always covers the whole
 * square (no empty edges), zoom keeps the middle of the view where it was,
 * and moving the photo stops at its edges.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface Crop {
  /** The photo's own size, in its pixels. */
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** The square view's side, in screen pixels. */
  readonly view: number;
  readonly zoom: number;
  /** Where the photo's top-left corner sits in the view (always at or left/above the view's corner). */
  readonly x: number;
  readonly y: number;
}

export interface SourceRect {
  readonly sx: number;
  readonly sy: number;
  readonly size: number;
}

function scaleOf(crop: Pick<Crop, 'imageWidth' | 'imageHeight' | 'view' | 'zoom'>): number {
  return (crop.view / Math.min(crop.imageWidth, crop.imageHeight)) * crop.zoom;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keeps the photo covering the square: never a gap at any edge. */
export function clampCrop(crop: Crop): Crop {
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
  const scale = scaleOf({ ...crop, zoom });
  const minX = crop.view - crop.imageWidth * scale;
  const minY = crop.view - crop.imageHeight * scale;
  return { ...crop, zoom, x: clamp(crop.x, minX, 0), y: clamp(crop.y, minY, 0) };
}

/** The photo centred and just covering the square. */
export function initialCrop(imageWidth: number, imageHeight: number, view: number): Crop {
  const scale = scaleOf({ imageWidth, imageHeight, view, zoom: 1 });
  return clampCrop({
    imageWidth,
    imageHeight,
    view,
    zoom: 1,
    x: (view - imageWidth * scale) / 2,
    y: (view - imageHeight * scale) / 2,
  });
}

/** Moves the photo by a screen distance, stopping at its edges. */
export function panCrop(crop: Crop, dx: number, dy: number): Crop {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });
}

/** Zooms around the middle of the view. */
export function zoomCrop(crop: Crop, zoom: number): Crop {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const before = scaleOf(crop);
  const after = scaleOf({ ...crop, zoom: next });
  const middle = crop.view / 2;
  const imageX = (middle - crop.x) / before;
  const imageY = (middle - crop.y) / before;
  return clampCrop({ ...crop, zoom: next, x: middle - imageX * after, y: middle - imageY * after });
}

/** The part of the photo, in its own pixels, that the square shows. */
export function sourceRect(crop: Crop): SourceRect {
  const scale = scaleOf(crop);
  const size = Math.min(crop.view / scale, crop.imageWidth, crop.imageHeight);
  return {
    sx: clamp(-crop.x / scale, 0, crop.imageWidth - size),
    sy: clamp(-crop.y / scale, 0, crop.imageHeight - size),
    size,
  };
}

/** Two letters for a name, shown when there is no photo. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}
