import { describe, expect, it } from 'vitest';
import {
  MAX_POPOVER_SHARE,
  MIN_POPOVER_HEIGHT,
  POPOVER_EDGE_MARGIN,
  placePopover,
} from './popover-placement';

const top = { top: 19, bottom: 63, left: 1216, right: 1322 };

describe('where a popover opens', () => {
  it('opens under a trigger near the top, as tall as its content when the room allows', () => {
    const fit = placePopover({
      trigger: top,
      viewport: { width: 1366, height: 768 },
      contentHeight: 400,
      width: 280,
    });
    expect(fit.placement).toBe('below');
    expect(fit.align).toBe('end');
    // The room below is 681px, but a popover never takes more than 70 percent of the window.
    expect(fit.maxHeight).toBe(Math.floor(768 * MAX_POPOVER_SHARE));
    expect(fit.maxHeight).toBeLessThan(768 - 63 - 8 - POPOVER_EDGE_MARGIN);
    expect(fit.maxHeight).toBeGreaterThanOrEqual(400);
  });

  it('never takes more than 70 percent of the window, however tall the window is', () => {
    for (const height of [600, 768, 900, 1080, 1440]) {
      const fit = placePopover({
        trigger: top,
        viewport: { width: 1920, height },
        contentHeight: 2000,
        width: 280,
      });
      expect(fit.maxHeight).toBeLessThanOrEqual(Math.floor(height * 0.7));
    }
  });

  it('keeps 16px between the popover and the bottom edge, whichever limit applies', () => {
    expect(POPOVER_EDGE_MARGIN).toBe(16);
    for (const height of [480, 520, 554, 600, 768, 1080]) {
      const fit = placePopover({
        trigger: top,
        viewport: { width: 1366, height },
        contentHeight: 600,
        width: 280,
      });
      // The popover's bottom is the trigger's bottom, the 8px gap and its height.
      expect(63 + 8 + fit.maxHeight).toBeLessThanOrEqual(height - POPOVER_EDGE_MARGIN);
    }
  });

  it('judges whether it fits below by the share it may take, not by its full content', () => {
    // 416px are free below and 492px above. The content is 600px, but it may only take 300px
    // (30 percent of 1000), which fits below, so it stays below the trigger.
    const fit = placePopover({
      trigger: { top: 516, bottom: 560, left: 600, right: 706 },
      viewport: { width: 1366, height: 1000 },
      contentHeight: 600,
      width: 280,
      maxShare: 0.3,
    });
    expect(fit.placement).toBe('below');
    expect(fit.maxHeight).toBe(300);
  });

  it('can be told a different share', () => {
    const fit = placePopover({
      trigger: top,
      viewport: { width: 1366, height: 1000 },
      contentHeight: 900,
      width: 280,
      maxShare: 0.5,
    });
    expect(fit.maxHeight).toBe(500);
  });

  it('is limited to the room when that is less than the share, so the content scrolls inside it', () => {
    const fit = placePopover({
      trigger: { top: 300, bottom: 344, left: 1136, right: 1242 },
      viewport: { width: 1280, height: 520 },
      contentHeight: 500,
      width: 280,
    });
    // Only 152px fit below and 276px above, so it opens above and takes just that room.
    expect(fit.placement).toBe('above');
    expect(fit.maxHeight).toBe(300 - 8 - 16);
    expect(fit.maxHeight).toBeLessThan(Math.floor(520 * 0.7));
    expect(fit.maxHeight).toBeLessThan(500);
  });

  it('on a short window the share is the limit, so rows scroll inside and the bottom stays clear', () => {
    const fit = placePopover({
      trigger: top,
      viewport: { width: 1280, height: 480 },
      contentHeight: 500,
      width: 280,
    });
    expect(fit.placement).toBe('below');
    expect(fit.maxHeight).toBe(Math.floor(480 * 0.7));
    expect(fit.maxHeight).toBeLessThan(500);
    expect(63 + 8 + fit.maxHeight + 16).toBeLessThanOrEqual(480);
  });

  it('opens above a trigger that sits low, when it does not fit below', () => {
    const fit = placePopover({
      trigger: { top: 700, bottom: 744, left: 20, right: 126 },
      viewport: { width: 1366, height: 768 },
      contentHeight: 500,
      width: 304,
    });
    expect(fit.placement).toBe('above');
    // 700 - 8 - 16 = 668 above, capped at 70 percent of the window (537).
    expect(fit.maxHeight).toBe(Math.floor(768 * 0.7));
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
    // 800 - 444 - 24 = 332 below; 400 - 24 = 376 above.
    expect(fit.placement).toBe('above');
    expect(fit.maxHeight).toBe(376);
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
