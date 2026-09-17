/**
 * PNG/JPEG pixel dimensions from a few fixed header bytes, never a decode.
 * Shared by `preview-renderer.ts` (the pre-decode pixel-count cap that
 * bounds `loadImage`'s worst-case memory before it ever runs) and
 * `content-limits.ts` (EVI-01's "40 megapixels per image" upload limit) so
 * the two never drift into independently-maintained copies of the same
 * header-parsing logic.
 */

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

function readUint32BE(bytes: Uint8Array, offset: number): number | undefined {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    return undefined;
  }
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

/** PNG pixel dimensions from the IHDR chunk (bytes 16-23): a fixed-offset header read, never a decode. */
export function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.byteLength < 24) return undefined;
  const isIhdr =
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (!isIhdr) return undefined;
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (width === undefined || height === undefined) return undefined;
  return { width, height };
}

const JPEG_SOF_MARKERS: ReadonlySet<number> = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
/** Markers with no length-prefixed segment body to skip over. */
const JPEG_STANDALONE_MARKERS: ReadonlySet<number> = new Set([0x01, 0xd8]);

/** JPEG pixel dimensions by scanning SOF markers: a bounded segment walk over headers, never a full decode. */
export function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  const maxOffset = Math.min(bytes.byteLength - 9, 2_000_000);
  let offset = 2; // skip the SOI marker (0xFFD8)
  while (offset < maxOffset) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) return undefined;
    if (JPEG_SOF_MARKERS.has(marker)) {
      const h0 = bytes[offset + 5];
      const h1 = bytes[offset + 6];
      const w0 = bytes[offset + 7];
      const w1 = bytes[offset + 8];
      if (h0 === undefined || h1 === undefined || w0 === undefined || w1 === undefined) {
        return undefined;
      }
      return { width: (w0 << 8) | w1, height: (h0 << 8) | h1 };
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    if (JPEG_STANDALONE_MARKERS.has(marker)) {
      offset += 2;
      continue;
    }
    const len0 = bytes[offset + 2];
    const len1 = bytes[offset + 3];
    if (len0 === undefined || len1 === undefined) return undefined;
    const segmentLength = (len0 << 8) | len1;
    if (segmentLength < 2) return undefined;
    offset += 2 + segmentLength;
  }
  return undefined;
}

/** Reads pixel dimensions for whichever of PNG/JPEG `contentType` names; `undefined` for anything else or an unparseable header. */
export function imageDimensions(
  contentType: string,
  bytes: Uint8Array,
): ImageDimensions | undefined {
  if (contentType === 'image/png') return pngDimensions(bytes);
  if (contentType === 'image/jpeg') return jpegDimensions(bytes);
  return undefined;
}
