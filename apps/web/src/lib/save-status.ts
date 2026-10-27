/**
 * The three honest answers a form can give about a change (spec B09, "Saving and visibility"):
 * Saving while the server is working, "Saved at" a time only after the server said yes, and
 * "Not saved" with the reason and a way to try again. Pure and safe to import from browser code.
 *
 * A time is always shown with its zone, in the person's own saved time zone when we know it, so
 * "Saved at 14:32" never leaves anyone guessing which 14:32 it was.
 */

import type { FormResult } from '../components/form-feedback';

export const SAVING_TEXT = 'Saving…';

/** The time zone as a name Intl accepts, or undefined to use the reader's own. */
function usableZone(timeZone: string | null | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

function moment(
  value: string | Date,
  timeZone: string | null | undefined,
  withDate: boolean,
): string {
  const zone = usableZone(timeZone);
  return new Date(value).toLocaleString('en-GB', {
    ...(withDate ? { year: 'numeric', month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(zone ? { timeZone: zone } : {}),
  });
}

/** A real moment with its day, for example "27 Oct 2026, 14:32 GMT+6". */
export function formatMoment(value: string | Date, timeZone?: string | null): string {
  return moment(value, timeZone, true);
}

/** "Saved at 14:32 GMT+6". Call it only with the time the server confirmed. */
export function savedAtText(value: string | Date, timeZone?: string | null): string {
  return `Saved at ${moment(value, timeZone, false)}`;
}

/**
 * "Not saved. <reason> Try again." The reason is the server's own plain sentence; an empty one
 * still gives a usable line, and a reason that already says to try again is not told twice.
 */
export function notSavedText(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return 'Not saved. Try again.';
  const detail = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  const sentence = /[.!?]$/.test(detail) ? detail : `${detail}.`;
  return /try again/i.test(sentence)
    ? `Not saved. ${sentence}`
    : `Not saved. ${sentence} Try again.`;
}

/**
 * What a form shows for its latest action result. Nothing before anything was sent; "Saved at"
 * only for a success the server timestamped; "Not saved" for every failure. The server's own
 * sentence is kept after the time or the reason, so nothing it said is lost.
 */
export function saveResult(
  state: { readonly ok: boolean; readonly message: string; readonly savedAt?: string | undefined },
  timeZone?: string | null,
): FormResult {
  if (!state.ok) {
    return { ok: false, message: notSavedText(state.message) };
  }
  if (state.savedAt) {
    const when = savedAtText(state.savedAt, timeZone);
    return { ok: true, message: state.message ? `${when}. ${state.message}` : `${when}.` };
  }
  return { ok: true, message: state.message };
}
