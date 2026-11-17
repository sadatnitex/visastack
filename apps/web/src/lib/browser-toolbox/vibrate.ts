import { motionAllowed } from './motion';

/** Pattern lengths in milliseconds: one short tap. */
const TAP_MS = 25;

/**
 * One short tap on a success (a photo taken, a file sent). Only when the browser can vibrate and
 * the person allows motion. Never call it for an error. Returns whether a tap was asked for.
 */
export function tapSuccess(): boolean {
  if (typeof navigator === 'undefined') return false;
  const vibrate = (navigator as { vibrate?: (pattern: number) => boolean }).vibrate;
  if (typeof vibrate !== 'function' || !motionAllowed()) return false;
  try {
    return vibrate.call(navigator, TAP_MS) === true;
  } catch {
    return false;
  }
}
