import { AVAILABLE_FLAG_CODES } from '../components/flags/available-flags';

/**
 * Which flags may be drawn as pictures. One file, owned by the product owner.
 *
 * TO HIDE A FLAG: add its two-letter code in lower case to the list below, for example
 * `['xx']`, and save. That place then shows the plain fallback everywhere (the emoji, the letters
 * badge on Windows, or the globe) and no picture is asked for. Take the code out again to bring the
 * flag back. The list ships empty: every place with an ISO code has a flag.
 */
export const HIDDEN_FLAG_CODES: readonly string[] = [];

const CODE = /^[a-z]{2}$/;
const AVAILABLE: ReadonlySet<string> = new Set(AVAILABLE_FLAG_CODES);

/**
 * The same-origin path of the flag picture for a country code, or null when no picture should be
 * drawn: the code is not two letters, has no flag file, or is on the hide-list above. Never a
 * `data:` or `blob:` address (the page policy only allows pictures from this site).
 */
export function flagSrc(
  iso2: string | null | undefined,
  hidden: readonly string[] = HIDDEN_FLAG_CODES,
): string | null {
  const code = (iso2 ?? '').trim().toLowerCase();
  if (!CODE.test(code) || !AVAILABLE.has(code) || hidden.includes(code)) return null;
  return `/flags/${code}.svg`;
}
