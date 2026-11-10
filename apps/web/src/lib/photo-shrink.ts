/**
 * Making a large phone photo smaller in the browser before it is sent (packet P2). Only a JPEG or
 * PNG photo that is over the per-file limit is touched; anything else, and anything under the
 * limit, goes exactly as chosen. The server still checks every file it receives and enforces its
 * own limit: nothing there trusts that the browser shrank anything.
 *
 * The long edge steps down from 4000 pixels (4000, 3200, 2600, 2000), and at each size the JPEG
 * quality steps from 0.9 to 0.85, until the copy fits. It never goes below 2000 pixels, so printed
 * text stays readable; if it still does not fit there, the person is told what to do instead.
 *
 * The copy is drawn on a canvas, which writes no location or other camera details. The camera's
 * rotation is applied while decoding (see photo-canvas.ts, whose decoder this reuses).
 */

import { type DecodedPhoto, decodePhoto } from '../components/profile-photo/photo-canvas';
import { formatFileSize } from './format-size';
import { withFileExtension } from './upload-rules';

/** The largest long edge tried, which also keeps a canvas inside what phones can draw. */
export const LONG_EDGE_STEPS: readonly number[] = [4000, 3200, 2600, 2000];
/** The long edge is never taken below this while the source is larger than it. */
export const MIN_LONG_EDGE = 2000;
/** JPEG quality, best first. */
export const QUALITY_STEPS: readonly number[] = [0.9, 0.85];
/** A source with more pixels than this is not decoded: a low-end phone would run out of memory. */
export const MAX_SOURCE_PIXELS = 50_000_000;

export interface ShrinkStep {
  readonly width: number;
  readonly height: number;
  readonly quality: number;
}

/**
 * The sizes to try, best first. The first is the source itself when its long edge is 4000 pixels
 * or less (a picture is never made bigger), then each lower step, never below 2000. For every
 * size the better quality comes first. Empty when the size is not a real picture size.
 */
export function shrinkPlan(width: number, height: number): readonly ShrinkStep[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return [];
  const longEdge = Math.max(width, height);
  const top = Math.min(longEdge, LONG_EDGE_STEPS[0] ?? longEdge);
  const edges = [top, ...LONG_EDGE_STEPS.filter((edge) => edge < top && edge >= MIN_LONG_EDGE)];
  const steps: ShrinkStep[] = [];
  for (const edge of edges) {
    const scale = edge / longEdge;
    const w = edge === longEdge ? width : Math.max(1, Math.round(width * scale));
    const h = edge === longEdge ? height : Math.max(1, Math.round(height * scale));
    for (const quality of QUALITY_STEPS) steps.push({ width: w, height: h, quality });
  }
  return steps;
}

export type FitResult =
  | { readonly ok: true; readonly blob: Blob; readonly step: ShrinkStep }
  /** `still_too_large`: the smallest allowed copy is still over the limit. `unreadable`: the browser could not make a copy. */
  | { readonly ok: false; readonly reason: 'still_too_large' | 'unreadable' };

/**
 * Walks the plan with `encode` and returns the first copy that fits under `limitBytes`. Pure
 * stepping logic: the browser's drawing is passed in, so it is tested without a canvas.
 */
export async function fitUnderLimit(
  size: { readonly width: number; readonly height: number },
  limitBytes: number,
  encode: (step: ShrinkStep) => Promise<Blob | null>,
): Promise<FitResult> {
  const plan = shrinkPlan(size.width, size.height);
  if (plan.length === 0) return { ok: false, reason: 'unreadable' };
  for (const step of plan) {
    const blob = await encode(step);
    if (!blob || blob.size < 1) return { ok: false, reason: 'unreadable' };
    if (blob.size <= limitBytes) return { ok: true, blob, step };
  }
  return { ok: false, reason: 'still_too_large' };
}

/** An opened picture: its size, a way to draw a copy of it, and a way to let go of its memory. */
export interface PhotoSession {
  readonly width: number;
  readonly height: number;
  encode(step: ShrinkStep): Promise<Blob | null>;
  close(): void;
}

export interface PhotoEngine {
  open(file: Blob): Promise<PhotoSession>;
}

function drawCopy(
  canvas: HTMLCanvasElement,
  photo: DecodedPhoto,
  step: ShrinkStep,
): Promise<Blob | null> {
  canvas.width = step.width;
  canvas.height = step.height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  // A PNG with see-through areas would turn black as a JPEG: paint white first.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, step.width, step.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(photo.source, 0, 0, step.width, step.height);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob && blob.type === 'image/jpeg' ? blob : null),
      'image/jpeg',
      step.quality,
    );
  });
}

/** The real thing: decode with the browser, draw on one canvas that is reused for every size. */
export const browserPhotoEngine: PhotoEngine = {
  async open(file) {
    const photo = await decodePhoto(file);
    if (photo.width * photo.height > MAX_SOURCE_PIXELS) {
      photo.close();
      throw new Error('photo too large to decode safely');
    }
    const canvas = document.createElement('canvas');
    return {
      width: photo.width,
      height: photo.height,
      encode: (step) => drawCopy(canvas, photo, step),
      close: () => {
        // Release the picture and the canvas's pixels at once, not when the page is next cleaned up.
        canvas.width = 0;
        canvas.height = 0;
        photo.close();
      },
    };
  },
};

export type ShrinkOutcome =
  | {
      readonly ok: true;
      /** The smaller copy, named like the original (a PNG becomes .jpg). */
      readonly file: File;
      readonly fromBytes: number;
      readonly toBytes: number;
    }
  | { readonly ok: false; readonly reason: 'still_too_large' | 'unreadable' };

/**
 * Makes one photo small enough to send. One photo at a time is the caller's job (the upload form
 * and the import queue both do it), so memory use stays at one picture on a low-end phone.
 */
export async function shrinkPhoto(
  file: File,
  limitBytes: number,
  engine: PhotoEngine = browserPhotoEngine,
): Promise<ShrinkOutcome> {
  let session: PhotoSession;
  try {
    session = await engine.open(file);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  try {
    const fit = await fitUnderLimit(session, limitBytes, (step) => session.encode(step));
    if (!fit.ok) return fit;
    const copy = new File([fit.blob], withFileExtension(file.name || 'Photo', 'image/jpeg'), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
    return { ok: true, file: copy, fromBytes: file.size, toBytes: copy.size };
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    session.close();
  }
}

/** The one line shown next to a photo that was made smaller. */
export function shrunkNotice(fromBytes: number, toBytes: number): string {
  return `Made smaller to fit: ${formatFileSize(fromBytes)} to ${formatFileSize(toBytes)}`;
}

/** What to do when a photo cannot be made small enough without losing the detail documents need. */
export function photoStillTooLargeMessage(limitLabel: string, pdfAccepted: boolean): string {
  return `This photo is larger than ${limitLabel}, and making it smaller would lose detail. Take the photo again${pdfAccepted ? ', or send a PDF' : ''}.`;
}
