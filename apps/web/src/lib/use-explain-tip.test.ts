import { describe, expect, it } from 'vitest';
import { POPOVER_EDGE_MARGIN } from './popover-placement';
import {
  EXPLAIN_CLOSE_DELAY,
  EXPLAIN_GAP,
  EXPLAIN_OPEN_DELAY,
  shiftIntoView,
} from './use-explain-tip';

describe('shiftIntoView keeps an Explain popup inside the screen', () => {
  it('leaves a popup that already fits where it is', () => {
    expect(shiftIntoView({ left: 40, width: 200, viewportWidth: 1024 })).toBe(0);
  });

  it('slides a popup past the left edge back to the margin', () => {
    expect(shiftIntoView({ left: -90, width: 288, viewportWidth: 320 })).toBe(
      90 + POPOVER_EDGE_MARGIN,
    );
  });

  it('slides a popup past the right edge back to the margin', () => {
    const left = 200;
    const shift = shiftIntoView({ left, width: 200, viewportWidth: 320 });
    expect(left + shift + 200).toBe(320 - POPOVER_EDGE_MARGIN);
  });

  it('on a screen narrower than the popup, keeps its start in view rather than its end', () => {
    const left = 100;
    const shift = shiftIntoView({ left, width: 400, viewportWidth: 320 });
    expect(left + shift).toBe(POPOVER_EDGE_MARGIN);
  });

  it('works at the narrowest supported width, 320 px, for any trigger position', () => {
    for (let left = -288; left <= 320; left += 8) {
      const shift = shiftIntoView({ left, width: 288, viewportWidth: 320 });
      expect(left + shift).toBeGreaterThanOrEqual(POPOVER_EDGE_MARGIN);
      expect(left + shift + 288).toBeLessThanOrEqual(320 - POPOVER_EDGE_MARGIN);
    }
  });
});

describe('the timings stay short and in order', () => {
  it('opens after a pause a passing pointer does not trigger, closes faster than it opens', () => {
    expect(EXPLAIN_OPEN_DELAY).toBeGreaterThanOrEqual(200);
    expect(EXPLAIN_OPEN_DELAY).toBeLessThanOrEqual(500);
    expect(EXPLAIN_CLOSE_DELAY).toBeLessThan(EXPLAIN_OPEN_DELAY);
    expect(EXPLAIN_GAP).toBe(8);
  });
});
