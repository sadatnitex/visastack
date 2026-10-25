import {
  type CropInput,
  type PhotoMeasurements,
  type PhotoSpec,
  computeCropBox,
  fileSizeRangeBytes,
  outputPlan,
  specAspect,
} from '@visastack/core/photo-specs';
import type { PhotoPreview, PhotoSizerPort, SizedPhoto } from '@visastack/services';
import type { Sharp, SharpOptions } from 'sharp';

type SharpFactory = ((input?: Uint8Array, options?: SharpOptions) => Sharp) & {
  cache(options: boolean): unknown;
};

let sharpLoad: Promise<SharpFactory> | undefined;

/**
 * sharp is a native module: it is loaded the first time a photo is sized, never when this package
 * is imported, so code that only needs another adapter never pays for it (or fails without it).
 * Its operation cache is switched off, so no decoded pixels of one person's photo stay in memory
 * after the request that needed them.
 */
function loadSharp(): Promise<SharpFactory> {
  sharpLoad ??= import('sharp').then((m) => {
    const sharp = m.default as unknown as SharpFactory;
    sharp.cache(false);
    return sharp;
  });
  return sharpLoad;
}

/** The only image formats read. Checked from the bytes themselves, never the stored content type. */
export const PHOTO_SIZER_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png']);

/** Thrown for a file that is not a JPEG or PNG image, before any pixels are decoded. */
export class UnsupportedPhotoFormatError extends Error {
  constructor(format: string | undefined) {
    super(`not a JPEG or PNG image (${format ?? 'unknown'})`);
    this.name = 'UnsupportedPhotoFormatError';
  }
}

/**
 * Visa photo sizing with sharp (owner request 2026-10-25). Crops, resizes and re-encodes a stored
 * passport photo to one published size. It never edits the face or the background: the only pixel
 * change besides scaling is filling see-through areas of a PNG with white, since a JPEG has no
 * transparency. The finished file carries no metadata at all apart from its DPI.
 *
 * Every decode is bounded: a pixel ceiling (the same 40 megapixels the upload limit allows),
 * sharp's strictest failOn level ('warning', its own advice for untrusted input) so damaged or
 * suspicious image data is refused rather than guessed at, only JPEG and PNG as detected from the
 * bytes, sequential reading to keep memory flat, no operation cache, and a processing timeout.
 */

export const PHOTO_SIZER_LIMIT_INPUT_PIXELS = 40_000_000;
export const PHOTO_SIZER_TIMEOUT_SECONDS = 10;
/** Longest edge of the copy that the checks are measured on, so the limits mean the same for every photo. */
export const PHOTO_ANALYSIS_EDGE = 640;
export const PHOTO_PREVIEW_EDGE = 480;

const WHITE = { r: 255, g: 255, b: 255 };

function open(sharp: SharpFactory, bytes: Uint8Array): Sharp {
  return sharp(bytes, {
    limitInputPixels: PHOTO_SIZER_LIMIT_INPUT_PIXELS,
    failOn: 'warning',
    sequentialRead: true,
    autoOrient: true,
  }).timeout({ seconds: PHOTO_SIZER_TIMEOUT_SECONDS });
}

/**
 * Reads the header only (no pixel decode): refuses any format other than JPEG or PNG, then gives
 * the size after the camera's rotation flag. Every operation below calls this first.
 */
async function inspect(
  sharp: SharpFactory,
  bytes: Uint8Array,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes, {
    limitInputPixels: PHOTO_SIZER_LIMIT_INPUT_PIXELS,
    failOn: 'warning',
  }).metadata();
  if (!PHOTO_SIZER_FORMATS.has(meta.format)) throw new UnsupportedPhotoFormatError(meta.format);
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new Error('the photo has no readable size');
  return { width, height };
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

interface RawImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Mean and spread of brightness, and Laplacian variance (edge strength), from RGB pixels. */
function lumaStats(img: RawImage): { mean: number; stdDev: number; sharpness: number } {
  const { data, width, height } = img;
  const count = width * height;
  const y = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const v = luma(data[i * 3] ?? 0, data[i * 3 + 1] ?? 0, data[i * 3 + 2] ?? 0);
    y[i] = v;
    sum += v;
  }
  const mean = sum / count;
  let sq = 0;
  for (let i = 0; i < count; i++) sq += ((y[i] ?? 0) - mean) ** 2;
  const stdDev = Math.sqrt(sq / count);

  // Edge strength is measured over the middle of the photo, where the face is, so a large plain
  // background does not make a sharp photo look blurry.
  const rowStart = Math.max(1, Math.floor(height * 0.15));
  const rowEnd = Math.min(height - 1, Math.ceil(height * 0.75));
  const colStart = Math.max(1, Math.floor(width * 0.25));
  const colEnd = Math.min(width - 1, Math.ceil(width * 0.75));
  let lapSum = 0;
  let lapSq = 0;
  let lapCount = 0;
  for (let row = rowStart; row < rowEnd; row++) {
    for (let col = colStart; col < colEnd; col++) {
      const i = row * width + col;
      const lap =
        4 * (y[i] ?? 0) -
        (y[i - 1] ?? 0) -
        (y[i + 1] ?? 0) -
        (y[i - width] ?? 0) -
        (y[i + width] ?? 0);
      lapSum += lap;
      lapSq += lap * lap;
      lapCount++;
    }
  }
  const lapMean = lapCount > 0 ? lapSum / lapCount : 0;
  const sharpness = lapCount > 0 ? lapSq / lapCount - lapMean * lapMean : 0;
  return { mean, stdDev, sharpness };
}

/**
 * Colour spread and brightness of the background strips: the top band and the upper part of each
 * side (the lower sides are left out, where shoulders usually reach the edge).
 */
function borderStats(img: RawImage): { stdDev: number; meanLuma: number } {
  const { data, width, height } = img;
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.08));
  const sideRows = Math.max(band + 1, Math.round(height * 0.6));
  const strips: { x0: number; x1: number; y0: number; y1: number }[] = [
    { x0: 0, x1: width, y0: 0, y1: band },
    { x0: 0, x1: band, y0: band, y1: sideRows },
    { x0: width - band, x1: width, y0: band, y1: sideRows },
  ];
  let spreadTotal = 0;
  let lumaTotal = 0;
  let lumaCount = 0;
  for (const s of strips) {
    const sums = [0, 0, 0];
    const squares = [0, 0, 0];
    let n = 0;
    for (let row = s.y0; row < s.y1; row++) {
      for (let col = s.x0; col < s.x1; col++) {
        const i = (row * width + col) * 3;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        sums[0] = (sums[0] ?? 0) + r;
        sums[1] = (sums[1] ?? 0) + g;
        sums[2] = (sums[2] ?? 0) + b;
        squares[0] = (squares[0] ?? 0) + r * r;
        squares[1] = (squares[1] ?? 0) + g * g;
        squares[2] = (squares[2] ?? 0) + b * b;
        lumaTotal += luma(r, g, b);
        lumaCount++;
        n++;
      }
    }
    if (n === 0) continue;
    let spread = 0;
    for (let c = 0; c < 3; c++) {
      const mean = (sums[c] ?? 0) / n;
      spread += Math.sqrt(Math.max(0, (squares[c] ?? 0) / n - mean * mean));
    }
    spreadTotal += spread / 3;
  }
  return {
    stdDev: spreadTotal / strips.length,
    meanLuma: lumaCount > 0 ? lumaTotal / lumaCount : 0,
  };
}

/** Size of the JFIF header `setJpegDensity` inserts. */
const JFIF_SEGMENT_BYTES = 18;

/**
 * Writes the DPI into the JPEG's JFIF header and nothing else: replaces the density of an existing
 * JFIF segment, or inserts a minimal one straight after the start marker.
 */
export function setJpegDensity(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  const density = Math.max(1, Math.min(0xffff, Math.round(dpi)));
  const hi = (density >> 8) & 0xff;
  const lo = density & 0xff;
  const hasJfif =
    jpeg[2] === 0xff &&
    jpeg[3] === 0xe0 &&
    jpeg[6] === 0x4a &&
    jpeg[7] === 0x46 &&
    jpeg[8] === 0x49 &&
    jpeg[9] === 0x46 &&
    jpeg[10] === 0x00;
  if (hasJfif) {
    const out = new Uint8Array(jpeg);
    out[13] = 0x01; // units: dots per inch
    out[14] = hi;
    out[15] = lo;
    out[16] = hi;
    out[17] = lo;
    return out;
  }
  const app0 = new Uint8Array(JFIF_SEGMENT_BYTES);
  app0.set([0xff, 0xe0, 0x00, 0x10], 0); // APP0 marker, segment length 16
  app0.set([0x4a, 0x46, 0x49, 0x46, 0x00], 4); // "JFIF" and a terminating zero
  app0.set([0x01, 0x01, 0x01, hi, lo, hi, lo, 0x00, 0x00], 9); // version 1.1, DPI, no thumbnail
  const out = new Uint8Array(jpeg.byteLength + app0.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}

const QUALITY_MAX = 92;
const QUALITY_MIN = 30;

async function encode(sharp: SharpFactory, raw: RawImage, quality: number): Promise<Uint8Array> {
  const buffer = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 3 },
  })
    .timeout({ seconds: PHOTO_SIZER_TIMEOUT_SECONDS })
    .jpeg({ quality, chromaSubsampling: '4:2:0' })
    .toBuffer();
  return new Uint8Array(buffer);
}

/**
 * The best quality that stays under `maxBytes` (a binary search over JPEG quality), or the top
 * quality when there is no ceiling. When even the top quality is below a published minimum, quality
 * 100 is tried; the result says honestly whether the range was met.
 */
async function encodeWithinRange(
  sharp: SharpFactory,
  raw: RawImage,
  range: { readonly min: number | null; readonly max: number | null } | null,
): Promise<{ bytes: Uint8Array; quality: number }> {
  // Leave room for the DPI header written afterwards.
  const max = range?.max != null ? range.max - JFIF_SEGMENT_BYTES : null;
  const min = range?.min ?? null;
  let best = await encode(sharp, raw, QUALITY_MAX);
  let bestQuality = QUALITY_MAX;
  if (max !== null && best.byteLength > max) {
    let low = QUALITY_MIN;
    let high = QUALITY_MAX - 1;
    let found: { bytes: Uint8Array; quality: number } | undefined;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const attempt = await encode(sharp, raw, mid);
      if (attempt.byteLength <= max) {
        found = { bytes: attempt, quality: mid };
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (found) {
      best = found.bytes;
      bestQuality = found.quality;
    } else {
      best = await encode(sharp, raw, QUALITY_MIN);
      bestQuality = QUALITY_MIN;
    }
  }
  if (min !== null && best.byteLength < min) {
    const top = await encode(sharp, raw, 100);
    if (max === null || top.byteLength <= max) {
      best = top;
      bestQuality = 100;
    }
  }
  return { bytes: best, quality: bestQuality };
}

async function toRaw(pipeline: Sharp): Promise<RawImage> {
  const { data, info } = await pipeline
    .flatten({ background: WHITE })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error('unexpected channel count');
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

export function createPhotoSizer(): PhotoSizerPort {
  return {
    async measure(bytes: Uint8Array): Promise<PhotoMeasurements> {
      const sharp = await loadSharp();
      const size = await inspect(sharp, bytes);
      const raw = await toRaw(
        open(sharp, bytes).resize({
          width: PHOTO_ANALYSIS_EDGE,
          height: PHOTO_ANALYSIS_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        }),
      );
      const stats = lumaStats(raw);
      const border = borderStats(raw);
      return {
        width: size.width,
        height: size.height,
        meanLuma: stats.mean,
        lumaStdDev: stats.stdDev,
        sharpness: stats.sharpness,
        borderStdDev: border.stdDev,
        borderMeanLuma: border.meanLuma,
      };
    },

    async preview(bytes: Uint8Array): Promise<PhotoPreview> {
      const sharp = await loadSharp();
      await inspect(sharp, bytes);
      const { data, info } = await open(sharp, bytes)
        .resize({
          width: PHOTO_PREVIEW_EDGE,
          height: PHOTO_PREVIEW_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: WHITE })
        .toColourspace('srgb')
        .jpeg({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      return { bytes: new Uint8Array(data), width: info.width, height: info.height };
    },

    async produce(bytes: Uint8Array, spec: PhotoSpec, crop: CropInput): Promise<SizedPhoto> {
      const sharp = await loadSharp();
      const size = await inspect(sharp, bytes);
      const box = computeCropBox(size.width, size.height, specAspect(spec), crop);
      const plan = outputPlan(spec, box);
      const raw = await toRaw(
        open(sharp, bytes)
          .extract(box)
          .resize(plan.widthPx, plan.heightPx, { fit: 'fill', kernel: 'lanczos3' }),
      );
      const range = fileSizeRangeBytes(spec);
      const encoded = await encodeWithinRange(sharp, raw, range);
      const finished = setJpegDensity(encoded.bytes, plan.dpi);
      return {
        bytes: finished,
        widthPx: raw.width,
        heightPx: raw.height,
        dpi: plan.dpi,
        quality: encoded.quality,
        cropBox: box,
        withinFileSizeRange:
          (range?.max == null || finished.byteLength <= range.max) &&
          (range?.min == null || finished.byteLength >= range.min),
      };
    },
  };
}
