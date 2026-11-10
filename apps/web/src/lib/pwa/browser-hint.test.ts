import { describe, expect, it } from 'vitest';
import {
  BROWSER_HINT_TEXT,
  type HintEnvironment,
  browserHint,
  hasHomeScreenMarker,
  readableScale,
} from './browser-hint';

/** A Pixel-sized Chrome tab by default; each test changes only what it is about. */
function env(
  overrides: {
    touch?: boolean;
    vendor?: string;
    screenWidth?: number;
    layoutWidth?: number;
    search?: string;
    displayMode?: 'browser' | 'standalone' | 'minimal-ui';
  } = {},
): HintEnvironment {
  const { touch = true, vendor = 'Google Inc.', screenWidth = 412, layoutWidth = 412 } = overrides;
  const { search = '', displayMode = 'browser' } = overrides;
  return {
    matchMedia: (query) => ({
      matches:
        query === '(pointer: coarse)'
          ? touch
          : query === '(display-mode: browser)'
            ? displayMode === 'browser'
            : false,
    }),
    navigator: { vendor, maxTouchPoints: touch ? 5 : 0 },
    screen: { width: screenWidth },
    document: { documentElement: { clientWidth: layoutWidth } },
    location: { search },
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
    expect(hint).toMatchObject({ show: true, reason: 'desktop-layout' });
    // 980 / 412: the line is enlarged so it reads at the phone's real size.
    expect(hint.show && hint.scale).toBeCloseTo(2.38, 1);
  });

  it('shows when the home-screen marker arrives in a browser tab', () => {
    expect(browserHint(env({ search: '?source=pwa' }))).toMatchObject({
      show: true,
      reason: 'home-screen-in-browser',
      scale: 1,
    });
  });

  it('stays hidden inside the installed app window, marker or not', () => {
    for (const displayMode of ['standalone', 'minimal-ui'] as const) {
      expect(browserHint(env({ search: '?source=pwa', displayMode }))).toEqual({ show: false });
    }
  });

  it('ignores other source values and a marker that is only part of another name', () => {
    expect(hasHomeScreenMarker('?source=email')).toBe(false);
    expect(hasHomeScreenMarker('?resource=pwa')).toBe(false);
    expect(hasHomeScreenMarker('?x=1&source=pwa')).toBe(true);
    expect(browserHint(env({ search: '?source=email' }))).toEqual({ show: false });
  });

  it('never flags a desktop computer, a tablet or a foldable opened out', () => {
    expect(browserHint(env({ touch: false, screenWidth: 1920, layoutWidth: 1920 }))).toEqual({
      show: false,
    });
    expect(browserHint(env({ screenWidth: 820, layoutWidth: 1180 }))).toEqual({ show: false });
  });

  it('never flags Safari or another iPhone browser, whose setting has other words', () => {
    expect(browserHint(env({ vendor: 'Apple Computer, Inc.', layoutWidth: 980 }))).toEqual({
      show: false,
    });
    expect(browserHint(env({ vendor: 'Apple Computer, Inc.', search: '?source=pwa' }))).toEqual({
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
