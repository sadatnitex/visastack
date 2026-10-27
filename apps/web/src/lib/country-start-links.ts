/**
 * Where a chosen country travels (Growth G2). Only strings in and out, so a browser component can
 * use it without loading the country data. The choice rides in the address (never a cookie): the
 * homepage hands it to sign-up as the place to land, and first run reads it back from there.
 */

/** The address parameter that carries a chosen country's two-letter code. */
export const COUNTRY_PARAM = 'country';

/** The address value of `step` that means "the country step is done, show the permission screen". */
export const COUNTRY_STEP_DONE = 'consent';

const ISO2 = /^[A-Za-z]{2}$/;

/** A two-letter code in capitals, or null when the text is not shaped like one. */
export function cleanIso2(value: unknown): string | null {
  return typeof value === 'string' && ISO2.test(value) ? value.toUpperCase() : null;
}

/** The first screen of the workspace with a country chosen (first run reads it back). */
export function appHrefForCountry(iso2: string): string {
  return `/app?${COUNTRY_PARAM}=${encodeURIComponent(iso2)}`;
}

/** First run's next screen, with the country still carried. */
export function permissionStepHref(iso2: string | null): string {
  const country = iso2 ? `${COUNTRY_PARAM}=${encodeURIComponent(iso2)}&` : '';
  return `/app?${country}step=${COUNTRY_STEP_DONE}`;
}

/** Create an account (or sign in, while sign-up is closed) and land on first run with the country kept. */
export function startHrefForCountry(iso2: string, signUpOpen: boolean): string {
  const next = encodeURIComponent(appHrefForCountry(iso2));
  return `${signUpOpen ? '/auth/sign-up' : '/auth/sign-in'}?next=${next}`;
}
