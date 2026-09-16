import { describe, expect, it } from 'vitest';
import { imageDimensions, jpegDimensions, pngDimensions } from './image-dimensions';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A hand-crafted PNG signature + IHDR chunk header only, no real pixel data. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_MAGIC, 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

describe('image-dimensions: header-only pixel dimensions, never a decode', () => {
  describe('pngDimensions', () => {
    it('reads width/height from a real IHDR chunk', async () => {
      const { createCanvas } = await import('@napi-rs/canvas');
      const canvas = createCanvas(37, 51);
      const bytes = new Uint8Array(canvas.toBuffer('image/png'));
      expect(pngDimensions(bytes)).toEqual({ width: 37, height: 51 });
    });

    it('reads dimensions from a header-only fixture with no real pixel data', () => {
      expect(pngDimensions(pngHeader(1024, 768))).toEqual({ width: 1024, height: 768 });
    });

    it('returns undefined for bytes too short to contain an IHDR chunk', () => {
      expect(pngDimensions(new Uint8Array(10))).toBeUndefined();
    });

    it('returns undefined for a non-PNG signature', () => {
      expect(pngDimensions(new Uint8Array(24))).toBeUndefined();
    });
  });

  describe('jpegDimensions', () => {
    it('reads width/height from a real SOF marker', async () => {
      const { createCanvas } = await import('@napi-rs/canvas');
      const canvas = createCanvas(64, 48);
      const bytes = new Uint8Array(canvas.toBuffer('image/jpeg'));
      expect(jpegDimensions(bytes)).toEqual({ width: 64, height: 48 });
    });

    it('returns undefined for bytes with no recognizable SOF marker', () => {
      expect(jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeUndefined();
    });

    it('returns undefined for an empty/tiny buffer', () => {
      expect(jpegDimensions(new Uint8Array(0))).toBeUndefined();
    });
  });

  describe('imageDimensions', () => {
    it('dispatches to pngDimensions for image/png', () => {
      expect(imageDimensions('image/png', pngHeader(10, 20))).toEqual({ width: 10, height: 20 });
    });

    it('returns undefined for a content type neither reader recognizes', () => {
      expect(imageDimensions('image/gif', new Uint8Array(24))).toBeUndefined();
    });
  });
});
