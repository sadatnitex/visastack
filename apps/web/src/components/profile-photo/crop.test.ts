import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, initialCrop, initialsOf, panCrop, sourceRect, zoomCrop } from './crop';

describe('square photo crop', () => {
  it('starts centred, covering the square with the short side', () => {
    const crop = initialCrop(1200, 800, 240);
    expect(sourceRect(crop)).toEqual({ sx: 200, sy: 0, size: 800 });
    expect(sourceRect(initialCrop(600, 900, 240))).toEqual({ sx: 0, sy: 150, size: 600 });
  });

  it('stops moving at the photo edges so no gap ever shows', () => {
    const crop = initialCrop(1200, 800, 240);
    expect(sourceRect(panCrop(crop, 10_000, 10_000))).toEqual({ sx: 0, sy: 0, size: 800 });
    expect(sourceRect(panCrop(crop, -10_000, -10_000))).toEqual({ sx: 400, sy: 0, size: 800 });
  });

  it('zooms around the middle and keeps zoom within its range', () => {
    const crop = initialCrop(1000, 1000, 200);
    const zoomed = sourceRect(zoomCrop(crop, 2));
    expect(zoomed.size).toBeCloseTo(500);
    expect(zoomed.sx).toBeCloseTo(250);
    expect(zoomed.sy).toBeCloseTo(250);
    expect(zoomCrop(crop, 99).zoom).toBe(MAX_ZOOM);
    expect(zoomCrop(crop, 0).zoom).toBe(MIN_ZOOM);
    // Zooming back out after moving still covers the square.
    const back = sourceRect(zoomCrop(panCrop(zoomCrop(crop, 3), -500, -500), 1));
    expect(back).toEqual({ sx: 0, sy: 0, size: 1000 });
  });

  it('makes two initials from a name', () => {
    expect(initialsOf('  rahima   akter khan ')).toBe('RA');
    expect(initialsOf('Nadia')).toBe('N');
    expect(initialsOf('')).toBe('');
  });
});
