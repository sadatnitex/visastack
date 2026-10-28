/**
 * The notice about this version (the public beta, pilot or test build banner) shows in full on a
 * visitor's first page and then folds away (owner list item 17), so it no longer takes the top of
 * every page on a phone. Seeing it once, or hiding it, is remembered on this device in one small
 * cookie rather than local storage, because only a cookie reaches the server: the next page is
 * then drawn without the notice from the first paint, with no flash and no inline script (the page
 * security policy admits only nonced scripts). The cookie holds one word and nothing about the
 * person, and every page renders correctly when it is missing or blocked: the notice then simply
 * shows again. The same words stay one tap away on the What Works Today page, linked from the
 * footer on every public page.
 */
export const VERSION_NOTICE_COOKIE = 'visastack_notice';

/** The one value the cookie ever holds. */
const SEEN = 'seen';

/** Half a year: long enough not to nag, short enough that a returning visitor is reminded. */
const HALF_A_YEAR_SECONDS = 60 * 60 * 24 * 182;

/** Anything but the exact word means the notice has not been seen, so it shows in full. */
export function parseVersionNoticeSeen(value: string | undefined | null): boolean {
  return value === SEEN;
}

/** The cookie text: the whole site (the notice is on every public page), same-site requests only. */
export function versionNoticeCookie(secure: boolean): string {
  return [
    `${VERSION_NOTICE_COOKIE}=${SEEN}`,
    'path=/',
    `max-age=${HALF_A_YEAR_SECONDS}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** Remember that this device has seen the notice. A blocked cookie store only means it shows again. */
export function rememberVersionNoticeSeen(): void {
  try {
    document.cookie = versionNoticeCookie(window.location.protocol === 'https:');
  } catch {
    // Not remembered; the notice shows again on the next page, which is the safe way round.
  }
}
