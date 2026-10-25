import type { PhotoReencoderPort } from '@visastack/services';

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

export class SharpPhotoReencoder implements PhotoReencoderPort {
  readonly name = 'sharp-photo-reencoder';
  readonly version = '1.1.0';
  private readonly timeoutMs: number;

  constructor(options: SharpPhotoReencoderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * A photo that takes too long is refused like an unreadable one (the caller
   * turns any failure into a plain refusal). sharp's own timeout stops the
   * image work itself; the outer deadline also covers reading the header.
   */
  async reencode(input: {
    readonly bytes: Uint8Array;
    readonly size: number;
    readonly maxInputPixels: number;
  }): Promise<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('photo took too long to process')), this.timeoutMs);
    });
    try {
      return await Promise.race([this.encode(input), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async encode(input: {
    readonly bytes: Uint8Array;
    readonly size: number;
    readonly maxInputPixels: number;
  }): Promise<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number }> {
    const sharp = await loadSharp();
    const options = {
      failOn: 'error',
      limitInputPixels: input.maxInputPixels,
      pages: 1,
      sequentialRead: true,
    } as const;
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
      .timeout({ seconds: Math.max(1, Math.ceil(this.timeoutMs / 1000)) })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), width: info.width, height: info.height };
  }
}
