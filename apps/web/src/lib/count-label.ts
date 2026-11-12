import { type Locale, formatNumber } from '@visastack/i18n';

/**
 * How a count is written on a small badge: the number itself up to the cap, then the cap with a
 * plus ("99+"). One rule for the bell and the phone tabs. The digits follow the language
 * (Bengali digits under Bengali); English stays as it was.
 */
export function countLabel(count: number, cap: number, locale: Locale = 'en'): string {
  const whole = Math.floor(count);
  return whole > cap ? `${formatNumber(cap, locale)}+` : formatNumber(whole, locale);
}
