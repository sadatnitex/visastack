import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { HeicConversionError, HeicJpegConverter, looksLikeHeic } from './heic-converter';
import { MADE_UP_HEIC_LARGE, MADE_UP_HEIC_SMALL } from './heic-fixtures';

const PIXELS = 40_000_000;

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HeicConversionError) return error.reason;
    throw error;
  }
  throw new Error('the conversion was expected to be refused');
}

describe('iPhone photo (HEIC) conversion', () => {
  it('recognises a HEIC file by its signature and nothing else', () => {
    expect(looksLikeHeic(MADE_UP_HEIC_SMALL)).toBe(true);
    expect(looksLikeHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]))).toBe(
      false,
    );
    // An AVIF picture uses the same container with another brand; it is not taken for a HEIC.
    const avif = new Uint8Array(MADE_UP_HEIC_SMALL);
    avif.set([0x61, 0x76, 0x69, 0x66], 8);
    expect(looksLikeHeic(avif)).toBe(false);
    expect(looksLikeHeic(new Uint8Array(8))).toBe(false);
  });

  it('makes a new JPEG with the same picture, the same size and none of the original metadata', async () => {
    const converted = await new HeicJpegConverter().convert({
      bytes: MADE_UP_HEIC_SMALL,
      maxInputPixels: PIXELS,
    });
    expect([converted.width, converted.height]).toEqual([64, 48]);
    expect(Array.from(converted.bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);

    const metadata = await sharp(converted.bytes).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(Buffer.from(converted.bytes).includes('MadeUpCam')).toBe(false);
    expect(Buffer.from(MADE_UP_HEIC_SMALL).includes('MadeUpCam')).toBe(true);

    // The four quarters keep their colours: red, green, blue and white.
    const { data, info } = await sharp(converted.bytes).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    };
    const near = (actual: number[], expected: number[]) =>
      actual.every((value, i) => Math.abs(value - (expected[i] ?? 0)) < 40);
    expect(near(at(8, 8), [220, 20, 20])).toBe(true);
    expect(near(at(56, 8), [20, 180, 20])).toBe(true);
    expect(near(at(8, 40), [20, 20, 220])).toBe(true);
    expect(near(at(56, 40), [255, 255, 255])).toBe(true);
  });

  it('refuses a photo above the pixel budget before decoding it', async () => {
    const converter = new HeicJpegConverter();
    expect(
      await refusal(converter.convert({ bytes: MADE_UP_HEIC_LARGE, maxInputPixels: 1_000_000 })),
    ).toBe('too_large');
    const fits = await converter.convert({ bytes: MADE_UP_HEIC_LARGE, maxInputPixels: 1_200_000 });
    expect([fits.width, fits.height]).toEqual([1200, 1000]);
  });

  it('refuses anything that is not a readable HEIC, without throwing anything else', async () => {
    const converter = new HeicJpegConverter();
    expect(
      await refusal(converter.convert({ bytes: new Uint8Array(64), maxInputPixels: PIXELS })),
    ).toBe('not_heic');
    // The right signature in front of nonsense: the decoder cannot read it.
    const broken = new Uint8Array(MADE_UP_HEIC_SMALL.subarray(0, 40));
    expect(await refusal(converter.convert({ bytes: broken, maxInputPixels: PIXELS }))).toBe(
      'unreadable',
    );
    // A cut-off file: the container reads but the picture data is gone.
    const truncated = new Uint8Array(
      MADE_UP_HEIC_SMALL.subarray(0, MADE_UP_HEIC_SMALL.byteLength - 300),
    );
    expect(await refusal(converter.convert({ bytes: truncated, maxInputPixels: PIXELS }))).toBe(
      'unreadable',
    );
  });

  it('gives up when a conversion runs past its time limit', async () => {
    const converter = new HeicJpegConverter({ timeoutMs: 1 });
    expect(
      await refusal(converter.convert({ bytes: MADE_UP_HEIC_LARGE, maxInputPixels: PIXELS })),
    ).toBe('too_slow');
  });
});
