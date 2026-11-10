import { describe, expect, it, vi } from 'vitest';
import {
  LONG_EDGE_STEPS,
  MAX_SOURCE_PIXELS,
  MIN_LONG_EDGE,
  type PhotoEngine,
  QUALITY_STEPS,
  type ShrinkStep,
  fitUnderLimit,
  photoStillTooLargeMessage,
  shrinkPhoto,
  shrinkPlan,
  shrunkNotice,
} from './photo-shrink';

/** A blob of a made-up size; no real picture is involved anywhere in this file. */
const blobOf = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
const longEdgeOf = (step: ShrinkStep) => Math.max(step.width, step.height);
const photoFile = (name: string, size: number, type = 'image/jpeg') =>
  new File([new Uint8Array(size)], name, { type, lastModified: 7 });

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

  it('says unreadable, and stops at once, when the browser cannot draw a copy', async () => {
    const encode = vi.fn(async () => null);
    expect(await fitUnderLimit({ width: 4032, height: 3024 }, 4000, encode)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(encode).toHaveBeenCalledTimes(1);
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

  it('limits the pixels it will decode so a low-end phone is not asked for too much', () => {
    expect(MAX_SOURCE_PIXELS).toBe(50_000_000);
  });
});

describe('the words', () => {
  it('says old size to new size in one short line', () => {
    expect(shrunkNotice(5_200_000, 3_400_000)).toBe('Made smaller to fit: 5.2 MB to 3.4 MB');
    expect(shrunkNotice(4_500_000, 900_000)).toBe('Made smaller to fit: 4.5 MB to 900 KB');
  });

  it('tells a person what to do when the photo cannot be made small enough', () => {
    expect(photoStillTooLargeMessage('4 MB', false)).toBe(
      'This photo is larger than 4 MB, and making it smaller would lose detail. Take the photo again.',
    );
    expect(photoStillTooLargeMessage('4 MB', true)).toBe(
      'This photo is larger than 4 MB, and making it smaller would lose detail. Take the photo again, or send a PDF.',
    );
    for (const line of [photoStillTooLargeMessage('4 MB', true), shrunkNotice(1, 2)]) {
      expect(line).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
