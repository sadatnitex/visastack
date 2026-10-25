import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CROP_ZOOM_MAX,
  PHOTO_CHECK_LIMITS,
  PHOTO_SPECS,
  type PhotoMeasurements,
  clampCropInput,
  computeCropBox,
  getPhotoSpec,
  minimumPixels,
  outputPlan,
  photoFindings,
  specAspect,
} from './photo-specs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('visa photo spec table', () => {
  it('gives every spec a source, a title, a publisher and a real checked-on date', () => {
    expect(PHOTO_SPECS.length).toBeGreaterThanOrEqual(7);
    const today = new Date().toISOString().slice(0, 10);
    for (const spec of PHOTO_SPECS) {
      expect(spec.sourceUrl, spec.id).toMatch(/^https:\/\/[^\s]+\.[^\s]+/);
      expect(spec.sourceTitle.trim().length, spec.id).toBeGreaterThan(3);
      expect(spec.sourcePublisher.trim().length, spec.id).toBeGreaterThan(3);
      expect(spec.checkedOn, spec.id).toMatch(ISO_DATE);
      expect(Number.isNaN(Date.parse(spec.checkedOn)), spec.id).toBe(false);
      expect(spec.checkedOn <= today, `${spec.id} checked in the future`).toBe(true);
    }
  });

  it('keeps ids unique and names plain, each naming its size', () => {
    const ids = PHOTO_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of PHOTO_SPECS) {
      expect(spec.id).toMatch(/^[a-z0-9-]+$/);
      expect(spec.name.endsWith(spec.sizeLabel), spec.id).toBe(true);
      expect(spec.name.includes(String.fromCodePoint(0x2014)), spec.id).toBe(false);
      expect(getPhotoSpec(spec.id)).toBe(spec);
    }
    expect(getPhotoSpec('made-up')).toBeUndefined();
  });

  it('has a usable size for every spec and only well-formed ranges', () => {
    for (const spec of PHOTO_SPECS) {
      expect(spec.physical !== null || spec.pixels !== null, spec.id).toBe(true);
      if (spec.physical) {
        expect(spec.physical.widthMm).toBeGreaterThan(0);
        expect(spec.physical.heightMm).toBeGreaterThanOrEqual(spec.physical.widthMm);
      }
      if (spec.headHeightMm) {
        expect(spec.headHeightMm.min).toBeLessThan(spec.headHeightMm.max);
        if (spec.physical) expect(spec.headHeightMm.max).toBeLessThan(spec.physical.heightMm);
      }
      if (spec.fileSizeKb?.min != null && spec.fileSizeKb.max != null) {
        expect(spec.fileSizeKb.min).toBeLessThan(spec.fileSizeKb.max);
      }
      expect(spec.format).toBe('JPEG');
      expect(specAspect(spec)).toBeGreaterThan(0);
    }
  });

  it('matches the country research already in the repo for the specs taken from it', () => {
    const batch = JSON.parse(
      readFileSync(new URL('./destinations/batch-001.json', import.meta.url), 'utf8'),
    ) as unknown;
    const sources: { url: string; checkedOn: string; exactWords: string }[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        const record = value as {
          readonly url?: unknown;
          readonly checkedOn?: unknown;
          readonly exactWords?: unknown;
        };
        if (
          typeof record.url === 'string' &&
          typeof record.checkedOn === 'string' &&
          typeof record.exactWords === 'string'
        ) {
          sources.push({
            url: record.url,
            checkedOn: record.checkedOn,
            exactWords: record.exactWords,
          });
        }
        Object.values(record).forEach(walk);
      }
    };
    walk(batch);
    expect(sources.length).toBeGreaterThan(0);
    const expected: Record<string, RegExp> = {
      'saudi-200px': /200 x 200 .*5 to 100 Kb/,
      'india-2x2': /\(2X2\).*white background/,
      'thailand-35x45': /3\.5 x 4\.5cm.*white background/,
    };
    for (const [id, words] of Object.entries(expected)) {
      const spec = getPhotoSpec(id);
      if (!spec) throw new Error(id);
      const source = sources.find((s) => s.url === spec.sourceUrl && words.test(s.exactWords));
      expect(source, id).toBeDefined();
      expect(source?.checkedOn, id).toBe(spec.checkedOn);
    }
    const saudi = getPhotoSpec('saudi-200px');
    expect(saudi?.pixels).toEqual({ width: 200, height: 200 });
    expect(saudi?.fileSizeKb).toEqual({ min: 5, max: 100 });
  });

  it('marks every spec not from the repo as read through search, so nobody reads more into it', () => {
    for (const spec of PHOTO_SPECS.filter((s) => s.checkedOn === '2026-10-25')) {
      expect(spec.note, spec.id).toMatch(/confirm/i);
    }
  });
});

describe('output size', () => {
  it('follows an exact pixel rule exactly', () => {
    const saudi = getPhotoSpec('saudi-200px');
    if (!saudi) throw new Error('spec');
    expect(outputPlan(saudi, { width: 50, height: 50 })).toEqual({
      widthPx: 200,
      heightPx: 200,
      dpi: 300,
    });
  });

  it('prints at 600 DPI when the crop holds enough detail, else 300 DPI', () => {
    const schengen = getPhotoSpec('schengen-35x45');
    if (!schengen) throw new Error('spec');
    expect(outputPlan(schengen, { width: 2000, height: 2600 })).toEqual({
      widthPx: 827,
      heightPx: 1063,
      dpi: 600,
    });
    expect(outputPlan(schengen, { width: 500, height: 640 })).toEqual({
      widthPx: 413,
      heightPx: 531,
      dpi: 300,
    });
    const us = getPhotoSpec('us-2x2');
    if (!us) throw new Error('spec');
    expect(outputPlan(us, { width: 100, height: 100 })).toEqual({
      widthPx: 600,
      heightPx: 600,
      dpi: 300,
    });
  });

  it('uses 600 DPI when a published digital minimum needs it', () => {
    const uk = getPhotoSpec('uk-35x45');
    if (!uk) throw new Error('spec');
    const plan = outputPlan(uk, { width: 100, height: 100 });
    expect(plan.dpi).toBe(600);
    expect(plan.widthPx).toBeGreaterThanOrEqual(600);
    expect(plan.heightPx).toBeGreaterThanOrEqual(750);
  });
});

describe('crop', () => {
  it('refuses anything that is not a finite number, and clamps the rest', () => {
    expect(clampCropInput({ offsetX: '0', offsetY: 0, zoom: 1 })).toBeUndefined();
    expect(clampCropInput({ offsetX: Number.NaN, offsetY: 0, zoom: 1 })).toBeUndefined();
    expect(
      clampCropInput({ offsetX: 0, offsetY: Number.POSITIVE_INFINITY, zoom: 1 }),
    ).toBeUndefined();
    expect(clampCropInput({ offsetX: 0, offsetY: 0, zoom: undefined })).toBeUndefined();
    expect(clampCropInput({ offsetX: -9, offsetY: 9, zoom: 99 })).toEqual({
      offsetX: -1,
      offsetY: 1,
      zoom: CROP_ZOOM_MAX,
    });
    expect(clampCropInput({ offsetX: 0, offsetY: 0, zoom: 0.1 })?.zoom).toBe(1);
  });

  it('centres the largest box of the right shape at zoom 1', () => {
    expect(computeCropBox(1000, 1000, 35 / 45)).toEqual({
      left: 111,
      top: 0,
      width: 778,
      height: 1000,
    });
    expect(computeCropBox(800, 2000, 1)).toEqual({ left: 0, top: 600, width: 800, height: 800 });
  });

  it('slides within the photo and never leaves it, whatever is asked', () => {
    const cases = [
      { offsetX: -1, offsetY: -1, zoom: 1 },
      { offsetX: 1, offsetY: 1, zoom: 1 },
      { offsetX: 1, offsetY: -1, zoom: 3 },
      { offsetX: -50, offsetY: 50, zoom: 50 },
    ];
    for (const crop of cases) {
      const box = computeCropBox(1200, 1500, 35 / 45, crop);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width).toBeLessThanOrEqual(1200);
      expect(box.top + box.height).toBeLessThanOrEqual(1500);
      expect(box.width).toBeGreaterThan(0);
      expect(Math.abs(box.width / box.height - 35 / 45)).toBeLessThan(0.01);
    }
    const leftmost = computeCropBox(1200, 1500, 1, { offsetX: -1, offsetY: 0, zoom: 2 });
    const rightmost = computeCropBox(1200, 1500, 1, { offsetX: 1, offsetY: 0, zoom: 2 });
    expect(leftmost.left).toBe(0);
    expect(rightmost.left + rightmost.width).toBe(1200);
    const zoomed = computeCropBox(1200, 1500, 1, { offsetX: 0, offsetY: 0, zoom: 2 });
    expect(zoomed.width).toBe(600);
  });
});

describe('guided checks', () => {
  const good: PhotoMeasurements = {
    width: 1200,
    height: 1500,
    meanLuma: 160,
    lumaStdDev: 50,
    sharpness: 400,
    borderStdDev: 3,
    borderMeanLuma: 240,
  };

  it('finds nothing in a good photo', () => {
    expect(photoFindings(good)).toEqual([]);
  });

  it('says in plain words what is wrong', () => {
    const titles = (m: Partial<PhotoMeasurements>) =>
      photoFindings({ ...good, ...m }).map((f) => f.title);
    expect(titles({ meanLuma: PHOTO_CHECK_LIMITS.tooDarkBelow - 1 })).toContain('Too dark');
    expect(titles({ meanLuma: PHOTO_CHECK_LIMITS.tooBrightAbove + 1 })).toContain('Too bright');
    expect(titles({ lumaStdDev: 5 })).toContain('Low contrast');
    expect(titles({ sharpness: 1 })).toContain('Looks blurry');
    expect(titles({ borderStdDev: 60 })).toContain('Background is not plain');
    expect(titles({ borderMeanLuma: 90 })).toContain('Background is not light');
    expect(titles({ width: 1500, height: 1200 })).toContain('Photo is wider than it is tall');
  });

  it('names each size a small photo cannot be printed at, once per size', () => {
    const small = photoFindings({ ...good, width: 400, height: 500 }).filter(
      (f) => f.id === 'too_small',
    );
    const titles = small.map((f) => f.title);
    expect(titles).toContain('Too small to print at 35 x 45 mm');
    expect(titles).toContain('Too small to print at 2 x 2 inches');
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).not.toContain('Too small for 200 x 200 pixels');
    const tiny = photoFindings({ ...good, width: 150, height: 190 }).map((f) => f.title);
    expect(tiny).toContain('Too small for 200 x 200 pixels');
  });

  it('agrees with the minimum each spec needs', () => {
    for (const spec of PHOTO_SPECS) {
      const need = minimumPixels(spec);
      expect(need.width).toBeGreaterThan(0);
      expect(need.height).toBeGreaterThan(0);
    }
  });
});
