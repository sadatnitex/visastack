import { describe, expect, it } from 'vitest';
import {
  BROWSER_HINT_TEXT,
  type HintEnvironment,
  browserHint,
  readableScale,
} from './browser-hint';

/** A Pixel-sized Chrome tab by default; each test changes only what it is about. */
function env(
  overrides: {
    touch?: boolean;
    vendor?: string;
    screenWidth?: number;
    layoutWidth?: number;
  } = {},
): HintEnvironment {
  const { touch = true, vendor = 'Google Inc.', screenWidth = 412, layoutWidth = 412 } = overrides;
  return {
    matchMedia: (query) => ({ matches: query === '(pointer: coarse)' && touch }),
    navigator: { vendor, maxTouchPoints: touch ? 5 : 0 },
    screen: { width: screenWidth },
    document: { documentElement: { clientWidth: layoutWidth } },
  };
}

describe('the browser hint', () => {
  it('says what to change, in one plain line', () => {
    expect(BROWSER_HINT_TEXT).toBe(
      'Opening in the browser? In Chrome, turn off Desktop site, then install VisaStack again.',
    );
  });

  it('stays hidden on a normal phone page', () => {
    expect(browserHint(env())).toEqual({ show: false });
  });

  it('shows for a phone drawing a desktop-wide page (Chrome Desktop site)', () => {
    const hint = browserHint(env({ layoutWidth: 980 }));
    expect(hint.show).toBe(true);
    // 980 / 412: the line is enlarged so it reads at the phone's real size.
    expect(hint.show && hint.scale).toBeCloseTo(2.38, 1);
  });

  it('never flags a desktop computer, a tablet or a foldable opened out', () => {
    expect(browserHint(env({ touch: false, screenWidth: 1920, layoutWidth: 1920 }))).toEqual({
      show: false,
    });
    expect(browserHint(env({ screenWidth: 820, layoutWidth: 1180 }))).toEqual({ show: false });
    // A touch laptop has no Desktop site setting to turn off.
    expect(browserHint(env({ screenWidth: 1366, layoutWidth: 1366 }))).toEqual({ show: false });
  });

  it('never flags Safari or another iPhone browser, whose setting has other words', () => {
    expect(browserHint(env({ vendor: 'Apple Computer, Inc.', layoutWidth: 980 }))).toEqual({
      show: false,
    });
  });

  it('keeps the enlargement within bounds and ignores nonsense widths', () => {
    expect(readableScale(980, 412)).toBeGreaterThan(2);
    expect(readableScale(2000, 200)).toBe(3);
    expect(readableScale(300, 412)).toBe(1);
    expect(readableScale(0, 412)).toBe(1);
    expect(readableScale(980, 0)).toBe(1);
    expect(readableScale(Number.NaN, 412)).toBe(1);
  });
});
