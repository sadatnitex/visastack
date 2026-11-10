import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LONG_EDGE_STEPS,
  MAX_SOURCE_PIXELS,
  MIN_LONG_EDGE,
  type PhotoEngine,
  QUALITY_STEPS,
  type ShrinkStep,
  browserPhotoEngine,
  fitUnderLimit,
  imageSizeFromHeader,
  photoNotShrunkMessage,
  shrinkPhoto,
  shrinkPlan,
  shrinkTargetBytes,
  shrunkNotice,
} from './photo-shrink';

/** A blob of a made-up size; no real picture is involved anywhere in this file. */
const blobOf = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
const longEdgeOf = (step: ShrinkStep) => Math.max(step.width, step.height);

/** The first bytes of a JPEG with this picture size (an APP0 segment, then a start-of-frame). */
function jpegHeader(width: number, height: number, sof = 0xc0): number[] {
  return [
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc4,
    0x00,
    0x04,
    0x00,
    0x00, // a table segment: its marker is not a frame
    0xff,
    sof,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ];
}
/** The first bytes of a PNG with this picture size. */
function pngHeader(width: number, height: number): number[] {
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...be(width),
    ...be(height),
    8,
    6,
    0,
    0,
    0,
  ];
}
/** A made-up photo of this many bytes whose header says it is `dims` pixels. */
function photoFile(
  name: string,
  size: number,
  type = 'image/jpeg',
  dims: readonly [number, number] = [4032, 3024],
) {
  const head = type === 'image/png' ? pngHeader(...dims) : jpegHeader(...dims);
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head);
  return new File([bytes], name, { type, lastModified: 7 });
}

describe('the sizes tried, best first', () => {
  it('steps a 4032 by 3024 phone photo from 4000 down to 2000, better quality first at each size', () => {
    const plan = shrinkPlan(4032, 3024);
    expect(plan.map((s) => [longEdgeOf(s), s.quality])).toEqual([
      [4000, 0.9],
      [4000, 0.85],
      [3200, 0.9],
      [3200, 0.85],
      [2600, 0.9],
      [2600, 0.85],
      [2000, 0.9],
      [2000, 0.85],
    ]);
    // The picture keeps its shape: 4032 x 3024 is 4:3, so is every copy.
    expect(plan[0]).toEqual({ width: 4000, height: 3000, quality: 0.9 });
    expect(plan[6]).toEqual({ width: 2000, height: 1500, quality: 0.9 });
  });

  it('never goes below 2000 pixels on the long edge', () => {
    for (const [w, h] of [
      [8000, 6000],
      [6000, 8000],
      [4000, 3000],
      [3000, 4000],
      [2500, 2500],
      [2001, 1000],
    ] as const) {
      const plan = shrinkPlan(w, h);
      expect(plan.length).toBeGreaterThan(0);
      for (const step of plan) expect(longEdgeOf(step)).toBeGreaterThanOrEqual(MIN_LONG_EDGE);
    }
    expect(Math.min(...LONG_EDGE_STEPS)).toBe(MIN_LONG_EDGE);
  });

  it('starts at the picture itself when it is not larger than 4000 pixels, and only goes down', () => {
    expect(shrinkPlan(3000, 2000).map((s) => [s.width, s.height, s.quality])).toEqual([
      [3000, 2000, 0.9],
      [3000, 2000, 0.85],
      [2600, 1733, 0.9],
      [2600, 1733, 0.85],
      [2000, 1333, 0.9],
      [2000, 1333, 0.85],
    ]);
  });

  it('never makes a small picture bigger: a source under 2000 pixels is tried as it is, at both qualities', () => {
    expect(shrinkPlan(1800, 1200)).toEqual(
      QUALITY_STEPS.map((quality) => ({ width: 1800, height: 1200, quality })),
    );
  });

  it('handles a portrait picture by its long edge, and a source exactly 4000 wide', () => {
    expect(shrinkPlan(3024, 4032)[0]).toEqual({ width: 3000, height: 4000, quality: 0.9 });
    expect(shrinkPlan(4000, 3000)[0]).toEqual({ width: 4000, height: 3000, quality: 0.9 });
  });

  it('gives no plan for a size that is not a picture', () => {
    expect(shrinkPlan(0, 100)).toEqual([]);
    expect(shrinkPlan(100, -1)).toEqual([]);
    expect(shrinkPlan(Number.NaN, 100)).toEqual([]);
    expect(shrinkPlan(10.5, 10)).toEqual([]);
  });
});

describe('finding the first copy that fits', () => {
  it('takes the largest size and best quality that fits, and tries nothing after it', async () => {
    const tried: ShrinkStep[] = [];
    // 4000 px copies are 5 MB, 3200 px copies are 3.5 MB.
    const encode = async (step: ShrinkStep) => {
      tried.push(step);
      return blobOf(longEdgeOf(step) === 4000 ? 5000 : 3500);
    };
    const fit = await fitUnderLimit({ width: 4032, height: 3024 }, 4000, encode);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.step).toEqual({ width: 3200, height: 2400, quality: 0.9 });
    expect(tried.map(longEdgeOf)).toEqual([4000, 4000, 3200]);
  });

  it('uses the lower quality before the next size down', async () => {
    const encode = async (step: ShrinkStep) => blobOf(step.quality === 0.9 ? 5000 : 3900);
    const fit = await fitUnderLimit({ width: 4032, height: 3024 }, 4000, encode);
    expect(fit.ok && fit.step).toEqual({ width: 4000, height: 3000, quality: 0.85 });
  });

  it('accepts a copy exactly at the limit', async () => {
    const fit = await fitUnderLimit({ width: 3000, height: 2000 }, 4000, async () => blobOf(4000));
    expect(fit.ok).toBe(true);
  });

  it('STOPS when even 2000 pixels at the lower quality is over the limit, after trying every size once', async () => {
    const tried: ShrinkStep[] = [];
    const encode = async (step: ShrinkStep) => {
      tried.push(step);
      return blobOf(4001);
    };
    const fit = await fitUnderLimit({ width: 4032, height: 3024 }, 4000, encode);
    expect(fit).toEqual({ ok: false, reason: 'still_too_large' });
    expect(tried).toHaveLength(8);
    // The last thing tried is the floor: 2000 pixels at 0.85. Nothing smaller is ever drawn.
    expect(tried.at(-1)).toEqual({ width: 2000, height: 1500, quality: 0.85 });
    expect(Math.min(...tried.map(longEdgeOf))).toBe(2000);
  });

  it('stops without drawing anything for a small picture that is still too large', async () => {
    const encode = vi.fn(async () => blobOf(9999));
    const fit = await fitUnderLimit({ width: 1800, height: 1200 }, 4000, encode);
    expect(fit).toEqual({ ok: false, reason: 'still_too_large' });
    expect(encode).toHaveBeenCalledTimes(2);
  });

  it('skips a size the browser cannot draw and tries the next one down', async () => {
    const tried: ShrinkStep[] = [];
    const encode = async (step: ShrinkStep) => {
      tried.push(step);
      if (longEdgeOf(step) === 4000) return null;
      if (longEdgeOf(step) === 3200) throw new Error('canvas lost');
      return blobOf(2000);
    };
    const fit = await fitUnderLimit({ width: 4032, height: 3024 }, 4000, encode);
    expect(fit.ok && fit.step).toEqual({ width: 2600, height: 1950, quality: 0.9 });
    expect(tried.map(longEdgeOf)).toEqual([4000, 4000, 3200, 3200, 2600]);
  });

  it('says unreadable only when no size at all could be drawn', async () => {
    const encode = vi.fn(async () => null);
    expect(await fitUnderLimit({ width: 4032, height: 3024 }, 4000, encode)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(encode).toHaveBeenCalledTimes(8);
    expect(await fitUnderLimit({ width: 4032, height: 3024 }, 4000, async () => blobOf(0))).toEqual(
      {
        ok: false,
        reason: 'unreadable',
      },
    );
    expect(await fitUnderLimit({ width: 0, height: 0 }, 4000, encode)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    // One size drawn but too large is the other answer.
    const mixed = async (step: ShrinkStep) => (longEdgeOf(step) === 2000 ? blobOf(9999) : null);
    expect(await fitUnderLimit({ width: 4032, height: 3024 }, 4000, mixed)).toEqual({
      ok: false,
      reason: 'still_too_large',
    });
  });
});

describe('reading the picture size from the first bytes, before anything is decoded', () => {
  const bytes = (list: number[]) => new Uint8Array(list);

  it('reads a JPEG past its other segments, including a progressive one', () => {
    expect(imageSizeFromHeader(bytes(jpegHeader(4032, 3024)))).toEqual({
      width: 4032,
      height: 3024,
    });
    expect(imageSizeFromHeader(bytes(jpegHeader(16320, 12240, 0xc2)))).toEqual({
      width: 16320,
      height: 12240,
    });
  });

  it('reads a PNG', () => {
    expect(imageSizeFromHeader(bytes(pngHeader(3000, 2000)))).toEqual({
      width: 3000,
      height: 2000,
    });
    expect(imageSizeFromHeader(bytes(pngHeader(70000, 50000)))).toEqual({
      width: 70000,
      height: 50000,
    });
  });

  it('gives nothing for anything else, or for a header that stops early', () => {
    expect(imageSizeFromHeader(bytes([]))).toBeNull();
    expect(imageSizeFromHeader(bytes([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull();
    expect(imageSizeFromHeader(bytes(jpegHeader(4032, 3024).slice(0, 30)))).toBeNull();
    expect(imageSizeFromHeader(bytes(pngHeader(3000, 2000).slice(0, 14)))).toBeNull();
    expect(imageSizeFromHeader(bytes(pngHeader(0, 2000)))).toBeNull();
  });
});

/** A stand-in for the browser's decoding and drawing, so no canvas is needed. */
function engineOf(
  width: number,
  height: number,
  sizeOf: (step: ShrinkStep) => number,
): { engine: PhotoEngine; close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  return {
    close,
    engine: {
      open: async () => ({
        width,
        height,
        encode: async (step) => blobOf(sizeOf(step)),
        close,
      }),
    },
  };
}

describe('shrinking one photo', () => {
  it('returns a smaller JPEG with the same name and the same date, and lets go of the picture', async () => {
    const { engine, close } = engineOf(4032, 3024, () => 3000);
    const out = await shrinkPhoto(photoFile('IMG_1234.jpg', 6000), 4000, engine);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.file.name).toBe('IMG_1234.jpg');
    expect(out.file.type).toBe('image/jpeg');
    expect(out.file.lastModified).toBe(7);
    expect(out.fromBytes).toBe(6000);
    expect(out.toBytes).toBe(3000);
    expect(out.file.size).toBe(3000);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps a .jpeg name as it is, and renames a PNG to .jpg because the type changed', async () => {
    const { engine } = engineOf(4032, 3024, () => 1000);
    const jpeg = await shrinkPhoto(photoFile('Scan.jpeg', 6000), 4000, engine);
    expect(jpeg.ok && jpeg.file.name).toBe('Scan.jpeg');
    const png = await shrinkPhoto(photoFile('Screenshot 4.png', 6000, 'image/png'), 4000, engine);
    expect(png.ok && png.file.name).toBe('Screenshot 4.jpg');
    const nameless = await shrinkPhoto(photoFile('', 6000), 4000, engine);
    expect(nameless.ok && nameless.file.name).toBe('Photo.jpg');
  });

  it('reports that it cannot be made small enough, and still lets go of the picture', async () => {
    const { engine, close } = engineOf(4032, 3024, () => 9999);
    expect(await shrinkPhoto(photoFile('big.jpg', 20000), 4000, engine)).toEqual({
      ok: false,
      reason: 'still_too_large',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reports unreadable when the browser cannot open the picture, and never throws', async () => {
    const open = vi.fn().mockRejectedValue(new Error('cannot decode'));
    expect(await shrinkPhoto(photoFile('odd.jpg', 6000), 4000, { open })).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    const close = vi.fn();
    const broken: PhotoEngine = {
      open: async () => ({
        width: 4000,
        height: 3000,
        encode: async () => {
          throw new Error('canvas lost');
        },
        close,
      }),
    };
    expect(await shrinkPhoto(photoFile('odd.jpg', 6000), 4000, broken)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not even open a picture with too many pixels, so a low-end phone is never asked to decode it', async () => {
    const open = vi.fn();
    const tooMany = photoFile('pano.jpg', 6000, 'image/jpeg', [16320, 12240]);
    expect(16320 * 12240).toBeGreaterThan(MAX_SOURCE_PIXELS);
    expect(await shrinkPhoto(tooMany, 4000, { open })).toEqual({ ok: false, reason: 'unreadable' });
    const png = photoFile('big.png', 6000, 'image/png', [8000, 8000]);
    expect(await shrinkPhoto(png, 4000, { open })).toEqual({ ok: false, reason: 'unreadable' });
    expect(open).not.toHaveBeenCalled();
    // Just under the guard is opened.
    const { engine } = engineOf(4032, 3024, () => 1000);
    const fine = await shrinkPhoto(
      photoFile('ok.jpg', 6000, 'image/jpeg', [7000, 7000]),
      4000,
      engine,
    );
    expect(fine.ok).toBe(true);
  });

  it('does not open a file whose size it cannot read from the start of the file', async () => {
    const open = vi.fn();
    const unknown = new File([new Uint8Array(6000)], 'odd.jpg', { type: 'image/jpeg' });
    expect(await shrinkPhoto(unknown, 4000, { open })).toEqual({ ok: false, reason: 'unreadable' });
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps a copy under the whole decimal megabytes of the limit, so it never reads as over it', async () => {
    expect(shrinkTargetBytes(4 * 1024 * 1024)).toBe(4_000_000);
    expect(shrinkTargetBytes(20 * 1024 * 1024)).toBe(20_000_000);
    expect(shrinkTargetBytes(1_500_000)).toBe(1_000_000);
    expect(shrinkTargetBytes(1000)).toBe(1000);
    // 4,100,000 bytes is under 4 MiB but would read as "4.1 MB" beside a page that says "4 MB".
    const { engine } = engineOf(4032, 3024, () => 4_100_000);
    expect(await shrinkPhoto(photoFile('a.jpg', 6_000_000), 4 * 1024 * 1024, engine)).toEqual({
      ok: false,
      reason: 'still_too_large',
    });
    const fits = engineOf(4032, 3024, () => 3_999_999);
    const ok = await shrinkPhoto(photoFile('a.jpg', 6_000_000), 4 * 1024 * 1024, fits.engine);
    expect(ok.ok).toBe(true);
  });

  it('gives up on a photo that never finishes, and the next photo still gets its turn', async () => {
    const hangs: PhotoEngine = { open: () => new Promise(() => undefined) };
    const first = await shrinkPhoto(photoFile('hang.jpg', 6000), 4000, hangs, 20);
    expect(first).toEqual({ ok: false, reason: 'unreadable' });
    const { engine } = engineOf(4032, 3024, () => 1000);
    expect((await shrinkPhoto(photoFile('next.jpg', 6000), 4000, engine)).ok).toBe(true);
  });

  it('shrinks one photo at a time for every caller', async () => {
    let open = 0;
    let most = 0;
    const engine: PhotoEngine = {
      open: async () => {
        open++;
        most = Math.max(most, open);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          width: 4032,
          height: 3024,
          encode: async () => blobOf(1000),
          close: () => {
            open--;
          },
        };
      },
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => shrinkPhoto(photoFile(`p${i}.jpg`, 6000), 4000, engine)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(most).toBe(1);
  });
});

describe('the browser engine (canvas stood in for)', () => {
  /** A canvas that records what is drawn on it, in order. */
  function fakeBrowser(options: { blobType?: string } = {}) {
    const calls: string[] = [];
    const bitmap = { width: 4032, height: 3024, close: vi.fn() };
    const context = {
      fillStyle: '',
      imageSmoothingQuality: '',
      fillRect: () => calls.push(`fill ${context.fillStyle}`),
      drawImage: () => calls.push('draw'),
    };
    const canvas = {
      width: 1,
      height: 1,
      getContext: () => context,
      toBlob: (done: (blob: Blob | null) => void, type: string, quality: number) => {
        calls.push(`encode ${type} ${quality}`);
        done(new Blob([new Uint8Array(10)], { type: options.blobType ?? type }));
      },
    };
    vi.stubGlobal('createImageBitmap', async () => bitmap);
    vi.stubGlobal('document', { createElement: () => canvas });
    return { calls, canvas, bitmap };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('paints white under the picture first, so see-through areas do not turn black', async () => {
    const { calls, canvas } = fakeBrowser();
    const session = await browserPhotoEngine.open(new Blob(['x']));
    const blob = await session.encode({ width: 2000, height: 1500, quality: 0.9 });
    expect(blob?.type).toBe('image/jpeg');
    expect(calls).toEqual(['fill #ffffff', 'draw', 'encode image/jpeg 0.9']);
    expect([canvas.width, canvas.height]).toEqual([2000, 1500]);
  });

  it('treats anything but a JPEG from the canvas as no copy', async () => {
    fakeBrowser({ blobType: 'image/png' });
    const session = await browserPhotoEngine.open(new Blob(['x']));
    expect(await session.encode({ width: 2000, height: 1500, quality: 0.9 })).toBeNull();
  });

  it('lets go of the picture and the canvas pixels when it is closed', async () => {
    const { canvas, bitmap } = fakeBrowser();
    const session = await browserPhotoEngine.open(new Blob(['x']));
    session.close();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });
});

describe('the words', () => {
  it('says old size to new size in one short line', () => {
    expect(shrunkNotice(5_200_000, 3_400_000)).toBe('Made smaller to fit: 5.2 MB to 3.4 MB');
    expect(shrunkNotice(4_500_000, 900_000)).toBe('Made smaller to fit: 4.5 MB to 900 KB');
  });

  it('tells a person what to do when the photo cannot be made small enough, and says if it was the browser', () => {
    expect(photoNotShrunkMessage('still_too_large', '4 MB', false)).toBe(
      'This photo is larger than 4 MB, and making it smaller would lose detail. Take the photo again.',
    );
    expect(photoNotShrunkMessage('still_too_large', '4 MB', true)).toBe(
      'This photo is larger than 4 MB, and making it smaller would lose detail. Take the photo again, or send a PDF.',
    );
    expect(photoNotShrunkMessage('unreadable', '4 MB', true)).toBe(
      'We could not make this photo smaller than 4 MB. Take the photo again, or send a PDF.',
    );
    for (const line of [
      photoNotShrunkMessage('still_too_large', '4 MB', true),
      photoNotShrunkMessage('unreadable', '4 MB', true),
      shrunkNotice(1, 2),
    ]) {
      expect(line).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
