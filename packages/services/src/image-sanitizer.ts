/**
 * Server-side image re-encoding for the small uploads that never reach the document scan runner
 * (S27): agency logos and image proofs of payment. Profile photos already get the same treatment
 * through `PhotoReencoderPort`.
 *
 * With the private scan runner (`MALWARE_SCANNER_PROVIDER=github_clamav`) the synchronous checker
 * for these uploads is structural only. Re-encoding closes that gap without a virus engine: the
 * image is decoded and a brand-new file is written from its pixels, so nothing but image data is
 * ever stored (no appended payload, no metadata, no second file hidden after the image). Only JPEG
 * and PNG are decoded; the output keeps the decoded format (PNG keeps transparency), so the stored
 * type is what the bytes really are, never what the browser claimed.
 */

export const SANITIZED_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;
export type SanitizedImageType = (typeof SANITIZED_IMAGE_TYPES)[number];

export interface SanitizedImage {
  readonly bytes: Uint8Array;
  readonly contentType: SanitizedImageType;
  readonly width: number;
  readonly height: number;
}

export interface ImageSanitizerPort {
  readonly name: string;
  readonly version: string;
  /** Throws for anything that is not a readable JPEG or PNG within the pixel ceiling. */
  sanitize(input: {
    readonly bytes: Uint8Array;
    /** Refused before decoding when the image is larger than this many pixels. */
    readonly maxInputPixels: number;
    /** The longest side of the output; smaller images are never enlarged. */
    readonly maxDimension: number;
  }): Promise<SanitizedImage>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/**
 * A sanitizer's answer is trusted only when it is a non-empty image of a declared type whose bytes
 * start with that type's signature and that fits the size and shape limits. Anything else is
 * refused like an unreadable image.
 */
export function isAcceptableSanitizedImage(
  image: SanitizedImage,
  limits: { readonly maxBytes: number; readonly maxDimension: number },
): boolean {
  const signature = image.contentType === 'image/png' ? PNG_SIGNATURE : JPEG_SIGNATURE;
  return (
    (SANITIZED_IMAGE_TYPES as readonly string[]).includes(image.contentType) &&
    image.bytes.byteLength > 0 &&
    image.bytes.byteLength <= limits.maxBytes &&
    image.width > 0 &&
    image.height > 0 &&
    image.width <= limits.maxDimension &&
    image.height <= limits.maxDimension &&
    signature.every((value, i) => image.bytes[i] === value)
  );
}
