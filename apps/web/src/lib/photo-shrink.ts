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

import {
  type DecodedPhoto,
  canvasToJpeg,
  decodePhoto,
} from '../components/profile-photo/photo-canvas';
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
/** The longest one photo may take to shrink; a decode or encode that hangs is given up on. */
export const SHRINK_TIMEOUT_MS = 60_000;
/** How much of the start of a file is read to find its picture size. */
const HEADER_BYTES = 1024 * 1024;

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
  /**
   * `still_too_large`: every size could be drawn and the smallest allowed copy is still over the
   * limit. `unreadable`: the browser could not draw a copy at any size.
   */
  | { readonly ok: false; readonly reason: 'still_too_large' | 'unreadable' };

/**
 * Walks the plan with `encode` and returns the first copy that fits under `limitBytes`. A size the
 * browser cannot draw (a canvas it cannot allocate on a low-memory phone) is skipped and the next,
 * smaller one is tried. Pure stepping logic: the browser's drawing is passed in, so it is tested
 * without a canvas.
 */
export async function fitUnderLimit(
  size: { readonly width: number; readonly height: number },
  limitBytes: number,
  encode: (step: ShrinkStep) => Promise<Blob | null>,
): Promise<FitResult> {
  const plan = shrinkPlan(size.width, size.height);
  let drawn = 0;
  for (const step of plan) {
    let blob: Blob | null = null;
    try {
      blob = await encode(step);
    } catch {
      blob = null;
    }
    if (!blob || blob.size < 1) continue;
    drawn++;
    if (blob.size <= limitBytes) return { ok: true, blob, step };
  }
  return { ok: false, reason: drawn > 0 ? 'still_too_large' : 'unreadable' };
}

/**
 * The picture size (width and height in pixels) written in the first bytes of a JPEG or PNG file,
 * or null when it cannot be found. Read before anything is decoded, so a picture too large for a
 * phone's memory is turned away without decoding it.
 */
export function imageSizeFromHeader(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  const at = (index: number) => bytes[index] ?? 0;
  const be32 = (index: number) =>
    at(index) * 0x1000000 + (at(index + 1) << 16) + (at(index + 2) << 8) + at(index + 3);
  // PNG: signature, then the IHDR chunk with width and height as 32-bit numbers.
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && bytes.length >= 24) {
    const width = be32(16);
    const height = be32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (at(0) !== 0xff || at(1) !== 0xd8) return null;
  let index = 2;
  while (index + 9 < bytes.length) {
    if (at(index) !== 0xff) return null;
    const marker = at(index + 1);
    if (marker === 0xff) {
      index += 1;
      continue;
    }
    // Markers without a length: standalone ones and restarts.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      index += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (at(index + 2) << 8) + at(index + 3);
    const startOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) {
      const height = (at(index + 5) << 8) + at(index + 6);
      const width = (at(index + 7) << 8) + at(index + 8);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length < 2) return null;
    index += 2 + length;
  }
  return null;
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
  return canvasToJpeg(canvas, step.quality);
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

export type ShrinkFailure = 'still_too_large' | 'unreadable';

export type ShrinkOutcome =
  | {
      readonly ok: true;
      /** The smaller copy, named like the original (a PNG becomes .jpg). */
      readonly file: File;
      readonly fromBytes: number;
      readonly toBytes: number;
    }
  | { readonly ok: false; readonly reason: ShrinkFailure };

/**
 * The size a smaller copy must come under. The limit is read by people in whole megabytes ("4 MB")
 * and sizes are shown in decimal megabytes, so a copy is kept under the whole decimal megabytes of
 * the limit: a copy never reads as larger than the limit the page names.
 */
export function shrinkTargetBytes(limitBytes: number): number {
  const wholeMegabytes = Math.floor(limitBytes / 1_000_000) * 1_000_000;
  return wholeMegabytes >= 1_000_000 ? Math.min(limitBytes, wholeMegabytes) : limitBytes;
}

async function readPictureSize(file: Blob) {
  try {
    return imageSizeFromHeader(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
  } catch {
    return null;
  }
}

async function shrinkNow(file: File, limitBytes: number, engine: PhotoEngine) {
  // Turned away before anything is decoded: a picture with too many pixels, or one whose size
  // cannot be found, is not opened on a phone that may not have the memory for it.
  const declared = await readPictureSize(file);
  if (!declared || declared.width * declared.height > MAX_SOURCE_PIXELS) {
    return { ok: false, reason: 'unreadable' } as const;
  }
  let session: PhotoSession;
  try {
    session = await engine.open(file);
  } catch {
    return { ok: false, reason: 'unreadable' } as const;
  }
  try {
    const fit = await fitUnderLimit(session, shrinkTargetBytes(limitBytes), (step) =>
      session.encode(step),
    );
    if (!fit.ok) return fit;
    const copy = new File([fit.blob], withFileExtension(file.name || 'Photo', 'image/jpeg'), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
    return { ok: true, file: copy, fromBytes: file.size, toBytes: copy.size } as const;
  } catch {
    return { ok: false, reason: 'unreadable' } as const;
  } finally {
    session.close();
  }
}

/** Photos wait their turn here, whoever asks: one decoded picture in memory at a time. */
let shrinkChain: Promise<unknown> = Promise.resolve();

/**
 * Makes one photo small enough to send. It never throws, gives up on a photo that takes longer
 * than `SHRINK_TIMEOUT_MS`, and shrinks one photo at a time across the whole page (the upload form
 * and the import list both call it), so a low-end phone holds one decoded picture, not several.
 */
export function shrinkPhoto(
  file: File,
  limitBytes: number,
  engine: PhotoEngine = browserPhotoEngine,
  timeoutMs: number = SHRINK_TIMEOUT_MS,
): Promise<ShrinkOutcome> {
  const turn = shrinkChain.then(
    () =>
      new Promise<ShrinkOutcome>((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, reason: 'unreadable' }), timeoutMs);
        shrinkNow(file, limitBytes, engine).then(
          (outcome) => {
            clearTimeout(timer);
            resolve(outcome);
          },
          () => {
            clearTimeout(timer);
            resolve({ ok: false, reason: 'unreadable' });
          },
        );
      }),
  );
  shrinkChain = turn;
  return turn;
}

/** The one line shown next to a photo that was made smaller. */
export function shrunkNotice(fromBytes: number, toBytes: number): string {
  return `Made smaller to fit: ${formatFileSize(fromBytes)} to ${formatFileSize(toBytes)}`;
}

/**
 * What to do when a photo could not be made small enough: either it cannot be made small enough
 * without losing the detail documents need, or the browser could not work on it at all.
 */
export function photoNotShrunkMessage(
  reason: ShrinkFailure,
  limitLabel: string,
  pdfAccepted: boolean,
): string {
  const next = `Take the photo again${pdfAccepted ? ', or send a PDF' : ''}.`;
  return reason === 'still_too_large'
    ? `This photo is larger than ${limitLabel}, and making it smaller would lose detail. ${next}`
    : `We could not make this photo smaller than ${limitLabel}. ${next}`;
}
