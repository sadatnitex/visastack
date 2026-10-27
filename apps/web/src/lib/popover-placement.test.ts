import { describe, expect, it } from 'vitest';
import { MIN_POPOVER_HEIGHT, placePopover } from './popover-placement';

const top = { top: 19, bottom: 63, left: 1216, right: 1322 };

describe('where a popover opens', () => {
  it('opens under a trigger near the top, as tall as its content when the room allows', () => {
    const fit = placePopover({
      trigger: top,
      viewport: { width: 1366, height: 768 },
      contentHeight: 500,
      width: 304,
    });
    expect(fit.placement).toBe('below');
    expect(fit.align).toBe('end');
    // The room below: the screen less the trigger, a gap and a margin. Never taller than that.
    expect(fit.maxHeight).toBe(768 - 63 - 8 - 12);
    expect(fit.maxHeight).toBeGreaterThanOrEqual(500);
  });

  it('is limited to the room on a short screen, so the content scrolls inside it', () => {
    const fit = placePopover({
      trigger: top,
      viewport: { width: 1280, height: 520 },
      contentHeight: 500,
      width: 304,
    });
    expect(fit.placement).toBe('below');
    expect(fit.maxHeight).toBe(520 - 63 - 8 - 12);
    expect(fit.maxHeight).toBeLessThan(500);
    // The popover's bottom edge (its top is the trigger's bottom plus the gap) stays on screen.
    expect(63 + 8 + fit.maxHeight + 12).toBeLessThanOrEqual(520);
  });

  it('opens above a trigger that sits low, when it does not fit below', () => {
    const fit = placePopover({
      trigger: { top: 700, bottom: 744, left: 20, right: 126 },
      viewport: { width: 1366, height: 768 },
      contentHeight: 500,
      width: 304,
    });
    expect(fit.placement).toBe('above');
    expect(fit.maxHeight).toBe(700 - 8 - 12);
    expect(fit.align).toBe('start');
  });

  it('stays below when it fits there, even if there is more room above', () => {
    const fit = placePopover({
      trigger: { top: 300, bottom: 344, left: 600, right: 706 },
      viewport: { width: 1366, height: 768 },
      contentHeight: 300,
      width: 304,
    });
    expect(fit.placement).toBe('below');
  });

  it('opens on the roomier side when it fits on neither', () => {
    const fit = placePopover({
      trigger: { top: 400, bottom: 444, left: 600, right: 706 },
      viewport: { width: 1366, height: 800 },
      contentHeight: 900,
      width: 304,
    });
    // 800 - 444 - 20 = 336 below; 400 - 20 = 380 above.
    expect(fit.placement).toBe('above');
    expect(fit.maxHeight).toBe(380);
  });

  it('never squeezes below a usable height, even on a very short window', () => {
    const fit = placePopover({
      trigger: { top: 10, bottom: 54, left: 100, right: 200 },
      viewport: { width: 1000, height: 120 },
      contentHeight: 500,
      width: 304,
    });
    expect(fit.maxHeight).toBe(MIN_POPOVER_HEIGHT);
  });

  it('lines up with the trigger edge that keeps it on screen', () => {
    const base = { viewport: { width: 1366, height: 768 }, contentHeight: 300, width: 304 };
    // Right-hand trigger: grows leftwards.
    expect(placePopover({ ...base, trigger: top }).align).toBe('end');
    // Left-hand trigger: no room to grow leftwards, so it grows rightwards.
    expect(
      placePopover({ ...base, trigger: { top: 19, bottom: 63, left: 20, right: 126 } }).align,
    ).toBe('start');
  });
});
