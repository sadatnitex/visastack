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
export class SharpPhotoReencoder implements PhotoReencoderPort {
  readonly name = 'sharp-photo-reencoder';
  readonly version = '1.0.0';

  async reencode(input: {
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
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), width: info.width, height: info.height };
  }
}
