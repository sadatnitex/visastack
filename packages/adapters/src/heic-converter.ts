/// <reference path="./heic-decode.d.ts" />

/**
 * iPhone photo conversion (UX-B): turns an untrusted HEIC or HEIF upload into a brand-new JPEG
 * before anything is stored, so every later step (the safety checks, storage, previews, the
 * reading pipeline, sharing) only ever meets a format it already handles.
 *
 * The prebuilt image library (sharp) cannot decode HEIC: its HEIF support is the AV1 kind (AVIF)
 * only, because the HEVC codec is not part of its build. Decoding therefore uses libheif compiled
 * to WebAssembly (`heic-decode`, which wraps `libheif-js`): no native code, and the decoder runs
 * inside the WebAssembly sandbox's own memory, so a malformed file cannot reach the host process
 * memory the way a native decoder bug could. sharp then only encodes plain pixels.
 *
 * Limits, all checked before the expensive step they protect:
 * - the bytes must carry a HEIF file signature with a HEVC or HEIF brand;
 * - the first (primary) image's size, read from the container, must fit the pixel budget
 *   before any pixel is decoded, which also bounds the decode time and memory (both grow
 *   roughly in line with the number of pixels);
 * - an outer deadline covers the whole conversion, and sharp's own timeout stops the encode.
 *   The decode itself is synchronous WebAssembly and cannot be interrupted part way: the pixel
 *   budget is what keeps it short.
 *
 * Nothing from the original is carried over: a fresh encode keeps only pixels, so EXIF (camera,
 * location), XMP and other metadata are dropped. The rotation is already applied by the decoder.
 * The original bytes are never written anywhere by this module.
 */

export interface HeicConversionInput {
  readonly bytes: Uint8Array;
  /** The largest picture accepted, in pixels (width times height). */
  readonly maxInputPixels: number;
}

export interface HeicConversionResult {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Why a photo could not be converted, for the caller's plain message. */
export type HeicConversionFailure = 'not_heic' | 'too_large' | 'unreadable' | 'too_slow';

export class HeicConversionError extends Error {
  constructor(readonly reason: HeicConversionFailure) {
    super(`heic conversion failed: ${reason}`);
  }
}

export interface HeicJpegConverterOptions {
  /** How long one photo may take before it is refused (default 20 seconds). */
  readonly timeoutMs?: number;
  /** JPEG quality, 1 to 100 (default 88: visually lossless for documents, about twice the HEIC size). */
  readonly quality?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_QUALITY = 88;

/**
 * Major brands of HEIF files holding HEVC pictures (and the generic HEIF ones iPhones and other
 * phones write). AVIF ("avif", "avis") is left out on purpose: it is not what phones send, and
 * the decoder here only reads HEVC.
 */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

/**
 * True when the bytes start like a HEIF file: an `ftyp` box at the very start whose major brand is
 * one of the HEIC or HEIF brands. Cheap, and never decodes anything.
 */
export function looksLikeHeic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (text(4, 8) !== 'ftyp') return false;
  return HEIF_BRANDS.has(text(8, 12));
}

type DecodeAll = typeof import('heic-decode')['default']['all'];
type DecodedImage = Awaited<ReturnType<Awaited<ReturnType<DecodeAll>>[number]['decode']>>;

// Loaded on first use, so the 2 MB decoder stays out of every code path that never meets a HEIC.
let decoderModule: Promise<DecodeAll> | undefined;
const loadDecoder = (): Promise<DecodeAll> => {
  decoderModule ??= import('heic-decode').then((module) => module.default.all);
  return decoderModule;
};
const loadSharp = async () => (await import('sharp')).default;

export class HeicJpegConverter {
  readonly name = 'heic-jpeg-converter';
  readonly version = '1.0.0';
  private readonly timeoutMs: number;
  private readonly quality: number;

  constructor(options: HeicJpegConverterOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.quality = options.quality ?? DEFAULT_QUALITY;
  }

  /** Convert a HEIC or HEIF photo to a new JPEG, or throw a `HeicConversionError`. */
  async convert(input: HeicConversionInput): Promise<HeicConversionResult> {
    if (!looksLikeHeic(input.bytes)) throw new HeicConversionError('not_heic');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HeicConversionError('too_slow')), this.timeoutMs);
    });
    try {
      return await Promise.race([this.run(input), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async run(input: HeicConversionInput): Promise<HeicConversionResult> {
    const decodeAll = await loadDecoder();
    let images: Awaited<ReturnType<DecodeAll>>;
    try {
      images = await decodeAll({ buffer: input.bytes });
    } catch {
      throw new HeicConversionError('unreadable');
    }
    try {
      const primary = images[0];
      if (!primary) throw new HeicConversionError('unreadable');
      const { width, height } = primary;
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 1 ||
        height < 1
      ) {
        throw new HeicConversionError('unreadable');
      }
      if (width * height > input.maxInputPixels) throw new HeicConversionError('too_large');

      let decoded: DecodedImage;
      try {
        decoded = await primary.decode();
      } catch {
        throw new HeicConversionError('unreadable');
      }
      if (
        decoded.width !== width ||
        decoded.height !== height ||
        decoded.data.byteLength !== width * height * 4
      ) {
        throw new HeicConversionError('unreadable');
      }

      const sharp = await loadSharp();
      const raw = Buffer.from(
        decoded.data.buffer,
        decoded.data.byteOffset,
        decoded.data.byteLength,
      );
      const { data, info } = await sharp(raw, {
        raw: { width, height, channels: 4 },
        limitInputPixels: input.maxInputPixels,
      })
        .flatten({ background: '#ffffff' })
        .toColourspace('srgb')
        .jpeg({ quality: this.quality, mozjpeg: true })
        .timeout({ seconds: Math.max(1, Math.ceil(this.timeoutMs / 1000)) })
        .toBuffer({ resolveWithObject: true });
      return { bytes: new Uint8Array(data), width: info.width, height: info.height };
    } catch (error) {
      if (error instanceof HeicConversionError) throw error;
      throw new HeicConversionError('unreadable');
    } finally {
      images.dispose();
    }
  }
}
