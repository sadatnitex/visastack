/**
 * "Opening in the browser?" hint for the installed app. Kept free of React so it is testable with
 * plain fakes; `components/pwa/pwa-runtime.tsx` shows it.
 *
 * Owner report, 10 Nov 2026: on Android the home-screen icon sometimes opens VisaStack with
 * Chrome's address bar and the desktop layout. That is what Chrome does when "Desktop site" is on:
 * the page runs in an ordinary tab, laid out about 980 pixels wide whatever the page asks for, and
 * a shortcut made in that state is a plain bookmark rather than an installed app. Nothing in the
 * site can switch the setting, so the page says what it is seeing and what to change.
 *
 * Two signs, either is enough:
 * 1. A touch phone drawing a desktop-wide page. The layout width is read from the document (not
 *    `innerWidth`, which shrinks when the person pinch-zooms) and compared with the screen width.
 * 2. The page was started from the home screen (the manifest's `?source=pwa` marker) but is
 *    running in a browser tab instead of the installed app's own window.
 */

import { HOME_SCREEN_MARKER } from '../deep-links';

/** The one line shown for either sign. */
export const BROWSER_HINT_TEXT =
  'Opening in the browser? In Chrome, turn off Desktop site, then install VisaStack again.';

/** Phones are at most this wide (CSS pixels). A tablet or a foldable opened out is never flagged. */
const PHONE_SCREEN_MAX = 600;

/** A layout this wide on a phone is a desktop layout (Chrome's Desktop site uses about 980). */
const DESKTOP_LAYOUT_MIN = 900;

/** The most the line is enlarged to stay readable on a shrunken desktop page. */
const MAX_SCALE = 3;

export interface HintEnvironment {
  readonly matchMedia: (query: string) => { readonly matches: boolean };
  readonly navigator: { readonly vendor?: string; readonly maxTouchPoints?: number };
  readonly screen: { readonly width: number };
  readonly document: { readonly documentElement: { readonly clientWidth: number } };
  readonly location: { readonly search: string };
}

export type BrowserHint =
  | { readonly show: false }
  | {
      readonly show: true;
      readonly reason: 'desktop-layout' | 'home-screen-in-browser';
      readonly scale: number;
    };

const HIDDEN: BrowserHint = { show: false };

/** Whether the address carries the home-screen marker. */
export function hasHomeScreenMarker(search: string): boolean {
  return new URLSearchParams(search).get(HOME_SCREEN_MARKER.name) === HOME_SCREEN_MARKER.value;
}

/**
 * How much to enlarge the line so it reads at the phone's real size. A desktop-wide page is shown
 * shrunk to fit the screen, so a normal 16 pixel line would be tiny; 1 means no change.
 */
export function readableScale(layoutWidth: number, screenWidth: number): number {
  if (!(layoutWidth > 0) || !(screenWidth > 0)) return 1;
  return Math.min(MAX_SCALE, Math.max(1, layoutWidth / screenWidth));
}

/**
 * Whether to show the hint, and why. Only Chromium browsers on a touch device are considered:
 * Chrome's setting is the one the line names, and Safari on an iPhone has its own wording.
 */
export function browserHint(env: HintEnvironment): BrowserHint {
  const touch =
    env.matchMedia('(pointer: coarse)').matches || (env.navigator.maxTouchPoints ?? 0) > 0;
  if (!touch) return HIDDEN;
  // Chrome, Edge and Samsung Internet report "Google Inc."; every browser on an iPhone says "Apple".
  if (!(env.navigator.vendor ?? '').includes('Google')) return HIDDEN;

  const layoutWidth = env.document.documentElement.clientWidth;
  const screenWidth = env.screen.width;
  const scale = readableScale(layoutWidth, screenWidth);

  if (screenWidth > 0 && screenWidth <= PHONE_SCREEN_MAX && layoutWidth >= DESKTOP_LAYOUT_MIN) {
    return { show: true, reason: 'desktop-layout', scale };
  }
  // A browser tab is the only display mode with an address bar; every installed window differs.
  if (
    hasHomeScreenMarker(env.location.search) &&
    env.matchMedia('(display-mode: browser)').matches
  ) {
    return { show: true, reason: 'home-screen-in-browser', scale };
  }
  return HIDDEN;
}
