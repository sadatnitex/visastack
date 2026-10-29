import { describe, expect, it } from 'vitest';
import {
  REDACTION_LIMITS,
  clampRedactionBox,
  describeRedactionBox,
  moveRedactionBox,
  padRedactionBox,
  parseRedactionBox,
  redactionPixelRect,
  resizeRedactionBox,
} from './redaction-boxes';

describe('safe copy boxes', () => {
  it('accepts a box inside the page and keeps six decimal places', () => {
    expect(parseRedactionBox({ x: 0.1234567, y: 0.5, w: 0.2, h: 0.1 })).toEqual({
      x: 0.123457,
      y: 0.5,
      w: 0.2,
      h: 0.1,
    });
    expect(parseRedactionBox({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('refuses anything that is not a finite box on the page, never clamping it', () => {
    for (const bad of [
      null,
      [],
      'box',
      { x: 0.1, y: 0.1, w: 0.1 },
      { x: Number.NaN, y: 0, w: 0.1, h: 0.1 },
      { x: Number.POSITIVE_INFINITY, y: 0, w: 0.1, h: 0.1 },
      { x: -0.1, y: 0, w: 0.1, h: 0.1 },
      { x: 0.95, y: 0, w: 0.1, h: 0.1 },
      { x: 0, y: 0.95, w: 0.1, h: 0.1 },
      { x: 0, y: 0, w: 0, h: 0.1 },
      { x: 0, y: 0, w: 0.1, h: REDACTION_LIMITS.minSide / 2 },
      { x: '0', y: 0, w: 0.1, h: 0.1 },
    ]) {
      expect(parseRedactionBox(bad)).toBeUndefined();
    }
  });

  it('moves and resizes inside the page', () => {
    const box = { x: 0.8, y: 0.8, w: 0.1, h: 0.1 };
    expect(moveRedactionBox(box, 0.5, 0.5)).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
    expect(moveRedactionBox(box, -2, -2)).toEqual({ x: 0, y: 0, w: 0.1, h: 0.1 });
    expect(resizeRedactionBox(box, 1, 1)).toEqual({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 });
    expect(resizeRedactionBox(box, -1, -1).w).toBe(REDACTION_LIMITS.minSide);
    expect(clampRedactionBox({ x: -1, y: 2, w: 3, h: 0 })).toEqual({
      x: 0,
      y: 1 - REDACTION_LIMITS.minSide,
      w: 1,
      h: REDACTION_LIMITS.minSide,
    });
    expect(padRedactionBox({ x: 0, y: 0.5, w: 0.1, h: 0.1 }, 0.05, 0.05)).toEqual({
      x: 0,
      y: 0.45,
      w: 0.15,
      h: 0.2,
    });
  });

  it('covers every partly covered pixel, padded, and never leaves the page', () => {
    expect(redactionPixelRect({ x: 0.101, y: 0.25, w: 0.2, h: 0.5 }, 100, 10, 0)).toEqual({
      left: 10,
      top: 2,
      width: 21,
      height: 6,
    });
    expect(redactionPixelRect({ x: 0, y: 0, w: 1, h: 1 }, 50, 40, 3)).toEqual({
      left: 0,
      top: 0,
      width: 50,
      height: 40,
    });
  });

  it('describes a box in plain words', () => {
    expect(describeRedactionBox({ x: 0.1, y: 0.25, w: 0.3, h: 0.05 })).toBe(
      '10% from the left, 25% from the top, 30% wide and 5% tall',
    );
  });
});
