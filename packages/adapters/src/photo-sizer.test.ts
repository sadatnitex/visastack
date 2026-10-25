import { type PhotoSpec, getPhotoSpec, photoFindings } from '@visastack/core/photo-specs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  PHOTO_SIZER_FORMATS,
  PHOTO_SIZER_LIMIT_INPUT_PIXELS,
  PHOTO_SIZER_TIMEOUT_SECONDS,
  UnsupportedPhotoFormatError,
  createPhotoSizer,
  setJpegDensity,
} from './photo-sizer';

const W = 900;
const H = 1100;

/** A made-up portrait: a textured oval "head" and shoulders on a background. No real person. */
function portraitPixels(
  options: {
    readonly background?: readonly [number, number, number];
    readonly noisyBackground?: boolean;
    readonly brightness?: number;
    readonly width?: number;
    readonly height?: number;
  } = {},
): { data: Buffer; width: number; height: number } {
  const width = options.width ?? W;
  const height = options.height ?? H;
  const bg = options.background ?? [245, 245, 245];
  const scale = options.brightness ?? 1;
  const data = Buffer.alloc(width * height * 3);
  let seed = 11;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - width / 2) / (width * 0.22);
      const dy = (y - height * 0.45) / (height * 0.25);
      const shoulders = y > height * 0.78 && Math.abs(x - width / 2) < width * 0.4;
      let colour: readonly number[];
      if (dx * dx + dy * dy < 1 || shoulders) {
        const shade = ((x >> 3) + (y >> 3)) % 2 ? 40 : 0;
        colour = [180 - shade, 140 - shade, 120 - shade];
      } else if (options.noisyBackground) {
        colour = [random() * 255, random() * 255, random() * 255];
      } else {
        colour = bg;
      }
      const i = (y * width + x) * 3;
      data[i] = Math.min(255, (colour[0] ?? 0) * scale);
      data[i + 1] = Math.min(255, (colour[1] ?? 0) * scale);
      data[i + 2] = Math.min(255, (colour[2] ?? 0) * scale);
    }
  }
  return { data, width, height };
}

async function jpeg(
  pixels: { data: Buffer; width: number; height: number },
  options: { readonly blur?: number; readonly orientation?: number; readonly exif?: boolean } = {},
): Promise<Uint8Array> {
  let pipeline = sharp(pixels.data, {
    raw: { width: pixels.width, height: pixels.height, channels: 3 },
  });
  if (options.blur) pipeline = pipeline.blur(options.blur);
  if (options.orientation || options.exif) {
    pipeline = pipeline.withMetadata({
      ...(options.orientation ? { orientation: options.orientation } : {}),
      density: 72,
    });
    if (options.exif) {
      pipeline = pipeline.withExif({ IFD0: { Copyright: 'Test', Artist: 'Someone' } });
    }
  }
  return new Uint8Array(await pipeline.jpeg({ quality: 90 }).toBuffer());
}

function spec(id: string): PhotoSpec {
  const found = getPhotoSpec(id);
  if (!found) throw new Error(id);
  return found;
}

const CENTRE = { offsetX: 0, offsetY: 0, zoom: 1 };
const sizer = createPhotoSizer();

describe('photo sizer: bounded decoding', () => {
  it('uses the upload pixel ceiling and a timeout', () => {
    expect(PHOTO_SIZER_LIMIT_INPUT_PIXELS).toBe(40_000_000);
    expect(PHOTO_SIZER_TIMEOUT_SECONDS).toBeLessThanOrEqual(10);
  });

  it('reads only JPEG and PNG, judged from the bytes, before decoding anything', async () => {
    expect([...PHOTO_SIZER_FORMATS].sort()).toEqual(['jpeg', 'png']);
    const pixels = portraitPixels({ width: 300, height: 380 });
    const raw = sharp(pixels.data, { raw: { width: 300, height: 380, channels: 3 } });
    const webp = new Uint8Array(await raw.clone().webp().toBuffer());
    const gif = new Uint8Array(await raw.clone().gif().toBuffer());
    const tiff = new Uint8Array(await raw.clone().tiff().toBuffer());
    for (const image of [webp, gif, tiff]) {
      await expect(sizer.measure(image)).rejects.toBeInstanceOf(UnsupportedPhotoFormatError);
      await expect(sizer.preview(image)).rejects.toBeInstanceOf(UnsupportedPhotoFormatError);
      await expect(sizer.produce(image, spec('us-2x2'), CENTRE)).rejects.toBeInstanceOf(
        UnsupportedPhotoFormatError,
      );
    }
    const png = new Uint8Array(await raw.clone().png().toBuffer());
    expect((await sizer.measure(png)).width).toBe(300);
  });

  it("switches off sharp's operation cache once it is loaded", async () => {
    await sizer.measure(await jpeg(portraitPixels({ width: 300, height: 380 })));
    const cache = sharp.cache() as { items: { max: number }; memory: { max: number } };
    expect(cache.items.max).toBe(0);
    expect(cache.memory.max).toBe(0);
  });

  it('refuses damaged image data instead of guessing', async () => {
    const good = await jpeg(portraitPixels());
    const damaged = good.slice(0, Math.floor(good.byteLength / 2));
    await expect(sizer.produce(damaged, spec('us-2x2'), CENTRE)).rejects.toThrow();
    await expect(sizer.measure(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});

describe('photo sizer: produced photo', () => {
  it('makes the exact pixel size with the DPI set', async () => {
    const source = await jpeg(portraitPixels({ width: 2400, height: 3000 }));
    const result = await sizer.produce(source, spec('schengen-35x45'), CENTRE);
    expect(result.widthPx).toBe(827);
    expect(result.heightPx).toBe(1063);
    expect(result.dpi).toBe(600);
    const meta = await sharp(result.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(827);
    expect(meta.height).toBe(1063);
    expect(meta.density).toBe(600);
  });

  it('falls back to 300 DPI for a smaller photo and keeps square sizes square', async () => {
    const source = await jpeg(portraitPixels());
    const result = await sizer.produce(source, spec('us-2x2'), CENTRE);
    expect([result.widthPx, result.heightPx, result.dpi]).toEqual([600, 600, 300]);
    expect((await sharp(result.bytes).metadata()).density).toBe(300);
  });

  it('strips every piece of metadata except the DPI', async () => {
    const source = await jpeg(portraitPixels(), { exif: true });
    const before = await sharp(source).metadata();
    expect(before.exif).toBeDefined();
    const result = await sizer.produce(source, spec('canada-35x45'), CENTRE);
    const meta = await sharp(result.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(Buffer.from(result.bytes).includes(Buffer.from('Someone'))).toBe(false);
  });

  it('meets a published file size range (Saudi Arabia: 200 x 200 pixels, 5 to 100 KB)', async () => {
    const source = await jpeg(portraitPixels({ noisyBackground: true }));
    const result = await sizer.produce(source, spec('saudi-200px'), CENTRE);
    expect([result.widthPx, result.heightPx]).toEqual([200, 200]);
    expect(result.bytes.byteLength).toBeGreaterThanOrEqual(5 * 1024);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(100 * 1024);
    expect(result.withinFileSizeRange).toBe(true);
  });

  it('lowers the quality until the file fits a tight ceiling', async () => {
    const source = await jpeg(portraitPixels({ noisyBackground: true, width: 2400, height: 3000 }));
    const loose = await sizer.produce(source, spec('schengen-35x45'), CENTRE);
    const maxKb = Math.floor((loose.bytes.byteLength * 0.6) / 1024);
    const tight: PhotoSpec = {
      ...spec('schengen-35x45'),
      id: 'tight',
      fileSizeKb: { min: null, max: maxKb },
    };
    const result = await sizer.produce(source, tight, CENTRE);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(maxKb * 1024);
    expect(result.quality).toBeLessThan(loose.quality);
    expect(result.withinFileSizeRange).toBe(true);
    expect([result.widthPx, result.heightPx]).toEqual([827, 1063]);
  });

  it('keeps an extreme crop request inside the photo', async () => {
    const source = await jpeg(portraitPixels());
    for (const crop of [
      { offsetX: -1, offsetY: -1, zoom: 3 },
      { offsetX: 1, offsetY: 1, zoom: 3 },
      { offsetX: 99, offsetY: -99, zoom: 99 },
    ]) {
      const result = await sizer.produce(source, spec('uk-35x45'), crop);
      const box = result.cropBox;
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width).toBeLessThanOrEqual(W);
      expect(box.top + box.height).toBeLessThanOrEqual(H);
    }
  });

  it("follows the camera's rotation flag before cropping", async () => {
    // Stored sideways (wider than tall) with a flag saying "turn a quarter".
    const sideways = await jpeg(portraitPixels({ width: H, height: W }), { orientation: 6 });
    const measured = await sizer.measure(sideways);
    expect([measured.width, measured.height]).toEqual([W, H]);
    const result = await sizer.produce(sideways, spec('us-2x2'), CENTRE);
    expect(result.cropBox.width).toBe(W);
  });

  it('writes the DPI header without touching the image data', () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9]);
    const withDpi = setJpegDensity(bare, 300);
    expect(withDpi.byteLength).toBe(bare.byteLength + 18);
    expect([...withDpi.subarray(6, 11)]).toEqual([0x4a, 0x46, 0x49, 0x46, 0x00]);
    expect(withDpi[13]).toBe(1);
    expect((withDpi[14] ?? 0) * 256 + (withDpi[15] ?? 0)).toBe(300);
    expect([...withDpi.subarray(20)]).toEqual([...bare.subarray(2)]);
    const again = setJpegDensity(withDpi, 600);
    expect(again.byteLength).toBe(withDpi.byteLength);
    expect((again[16] ?? 0) * 256 + (again[17] ?? 0)).toBe(600);
    expect(() => setJpegDensity(new Uint8Array([1, 2, 3]), 300)).toThrow();
  });
});

describe('photo sizer: guided checks on made-up photos', () => {
  async function findingIds(image: Uint8Array): Promise<string[]> {
    return photoFindings(await sizer.measure(image)).map((f) => f.id);
  }

  it('finds nothing in a clear, well-lit photo on a plain light background', async () => {
    expect(await findingIds(await jpeg(portraitPixels({ width: 1800, height: 2200 })))).toEqual([]);
  });

  it('notices a dark photo', async () => {
    expect(await findingIds(await jpeg(portraitPixels({ brightness: 0.25 })))).toContain(
      'too_dark',
    );
  });

  it('notices a blurry photo', async () => {
    const ids = await findingIds(await jpeg(portraitPixels(), { blur: 8 }));
    expect(ids).toContain('blurry');
  });

  it('notices a busy background and a dark background', async () => {
    expect(await findingIds(await jpeg(portraitPixels({ noisyBackground: true })))).toContain(
      'background_not_plain',
    );
    expect(await findingIds(await jpeg(portraitPixels({ background: [90, 90, 90] })))).toContain(
      'background_not_light',
    );
  });

  it('notices a small photo and a sideways one', async () => {
    const ids = await findingIds(await jpeg(portraitPixels({ width: 300, height: 380 })));
    expect(ids).toContain('too_small');
    expect(await findingIds(await jpeg(portraitPixels({ width: 1100, height: 900 })))).toContain(
      'not_portrait',
    );
  });

  it('makes a small preview with no metadata', async () => {
    const preview = await sizer.preview(await jpeg(portraitPixels(), { exif: true }));
    expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(480);
    const meta = await sharp(preview.bytes).metadata();
    expect(meta.exif).toBeUndefined();
  });
});
