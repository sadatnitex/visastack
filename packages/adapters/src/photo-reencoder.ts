import type { ImageSanitizerPort, PhotoReencoderPort, SanitizedImage } from '@visastack/services';

/** Same value as `IMAGE_TOO_LARGE_CODE` in @visastack/services (types only are imported here). */
const IMAGE_TOO_LARGE_CODE = 'image_too_large';

// Loaded on first use: the native image library stays out of every code path that never handles a photo.
const loadSharp = async () => (await import('sharp')).default;

/**
 * Profile photo re-encoder (WP-PH1). Decodes untrusted, already
 * safety-scanned JPEG or PNG bytes and writes a brand-new square JPEG:
 *
 * - only JPEG and PNG are decoded at all, whatever the caller declared;
 * - the decoder stops at the first error and refuses images above the pixel
 *   ceiling before allocating them, and only the first frame is read;
 * - the camera's rotation is applied to the pixels, then every piece of
 *   metadata (EXIF including location, XMP, IPTC, ICC, comments) is dropped,
 *   because a fresh encode only carries what is explicitly kept and nothing
 *   is kept;
 * - transparency is flattened onto white and the result is centre-cropped to
 *   `size` x `size`, so the output shape never depends on the input.
 */
export interface SharpPhotoReencoderOptions {
  /** How long one photo may take before it is refused (default 10 seconds). */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The decoder rules both re-encoders share: stop at the first error, refuse images above the
 * pixel ceiling before allocating them, read only the first frame, read sequentially.
 */
function decodeOptions(maxInputPixels: number) {
  return {
    failOn: 'error',
    limitInputPixels: maxInputPixels,
    pages: 1,
    sequentialRead: true,
  } as const;
}

/** sharp's own per-pipeline time limit, in whole seconds, derived from the outer deadline. */
function sharpTimeout(timeoutMs: number): { readonly seconds: number } {
  return { seconds: Math.max(1, Math.ceil(timeoutMs / 1000)) };
}

/**
 * Runs `work` against an outer deadline. sharp work cannot be cancelled from outside, so every
 * pipeline the work starts also carries sharp's own `timeout` (see `sharpTimeout`), which makes
 * sharp itself stop that pipeline once the time is up; reading the header (`metadata`) has no such
 * option in sharp, but it only parses the header. A refusal for taking too long reads like any
 * other unreadable image to the caller.
 */
async function withDeadline<T>(
  timeoutMs: number,
  what: string,
  work: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took too long to process`)), timeoutMs);
  });
  const running = work();
  // The losing side must not surface later as an unhandled rejection.
  running.catch(() => undefined);
  try {
    return await Promise.race([running, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export class SharpPhotoReencoder implements PhotoReencoderPort {
  readonly name = 'sharp-photo-reencoder';
  readonly version = '1.1.0';
  private readonly timeoutMs: number;

  constructor(options: SharpPhotoReencoderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** A photo that takes too long is refused like an unreadable one (see `withDeadline`). */
  async reencode(input: {
    readonly bytes: Uint8Array;
    readonly size: number;
    readonly maxInputPixels: number;
  }): Promise<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number }> {
    return withDeadline(this.timeoutMs, 'photo', () => this.encode(input));
  }

  private async encode(input: {
    readonly bytes: Uint8Array;
    readonly size: number;
    readonly maxInputPixels: number;
  }): Promise<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number }> {
    const sharp = await loadSharp();
    const options = decodeOptions(input.maxInputPixels);
    const metadata = await sharp(input.bytes, options).metadata();
    if (metadata.format !== 'jpeg' && metadata.format !== 'png') {
      throw new Error('unsupported photo format');
    }
    const { data, info } = await sharp(input.bytes, options)
      .rotate()
      .resize(input.size, input.size, { fit: 'cover', position: 'centre' })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: 85, mozjpeg: true })
      .timeout(sharpTimeout(this.timeoutMs))
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), width: info.width, height: info.height };
  }
}

/**
 * Logo and payment-proof re-encoder (S27). Same decoder rules as the photo re-encoder above (JPEG
 * and PNG only whatever was declared, stop at the first error, pixel ceiling before allocation,
 * first frame only, rotation applied, every piece of metadata dropped), but the shape is kept:
 * the image is only scaled down to fit `maxDimension`, never cropped or enlarged. The result is a
 * brand-new file written from the pixels: nothing else from the upload survives.
 *
 * Output, smallest faithful form first, so a valid upload is not refused because its cleaned copy
 * grew: a PNG source becomes a palette PNG when the source is paletted, otherwise a PNG (logos
 * keep transparency); if that is still above `maxOutputBytes` and the image has no transparency,
 * a high-quality JPEG. A JPEG source stays a JPEG. Only when nothing fits is it refused, with the
 * `image_too_large` code. The stored type is always what the bytes really are.
 */
export class SharpImageSanitizer implements ImageSanitizerPort {
  readonly name = 'sharp-image-sanitizer';
  readonly version = '1.1.0';
  private readonly timeoutMs: number;

  constructor(options: SharpPhotoReencoderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sanitize(input: {
    readonly bytes: Uint8Array;
    readonly maxInputPixels: number;
    readonly maxDimension: number;
    readonly maxOutputBytes: number;
  }): Promise<SanitizedImage> {
    return withDeadline(this.timeoutMs, 'image', () => this.encode(input));
  }

  private async encode(input: {
    readonly bytes: Uint8Array;
    readonly maxInputPixels: number;
    readonly maxDimension: number;
    readonly maxOutputBytes: number;
  }): Promise<SanitizedImage> {
    const sharp = await loadSharp();
    const options = decodeOptions(input.maxInputPixels);
    const metadata = await sharp(input.bytes, options).metadata();
    if (metadata.format !== 'jpeg' && metadata.format !== 'png') {
      throw new Error('unsupported image format');
    }
    const pixels = () =>
      sharp(input.bytes, options)
        .rotate()
        .resize(input.maxDimension, input.maxDimension, { fit: 'inside', withoutEnlargement: true })
        .toColourspace('srgb')
        .timeout(sharpTimeout(this.timeoutMs));
    const attempts: {
      readonly contentType: SanitizedImage['contentType'];
      run: () => Promise<{ data: Buffer; info: { width: number; height: number } }>;
    }[] = [];
    if (metadata.format === 'png') {
      if (metadata.isPalette) {
        attempts.push({
          contentType: 'image/png',
          run: () =>
            pixels()
              .png({ palette: true, compressionLevel: 9 })
              .toBuffer({ resolveWithObject: true }),
        });
      }
      attempts.push({
        contentType: 'image/png',
        run: () => pixels().png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true }),
      });
    }
    if (metadata.format === 'jpeg' || !metadata.hasAlpha) {
      attempts.push({
        contentType: 'image/jpeg',
        run: () =>
          pixels()
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 90, mozjpeg: true })
            .toBuffer({ resolveWithObject: true }),
      });
    }
    for (const attempt of attempts) {
      const { data, info } = await attempt.run();
      if (data.byteLength <= input.maxOutputBytes) {
        return {
          bytes: new Uint8Array(data),
          contentType: attempt.contentType,
          width: info.width,
          height: info.height,
        };
      }
    }
    throw Object.assign(new Error('image is too large after cleaning'), {
      code: IMAGE_TOO_LARGE_CODE,
    });
  }
}
