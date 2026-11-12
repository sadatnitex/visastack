import { type Locale, formatNumber } from '@visastack/i18n';

/**
 * A number shown on its own (a tile, a badge, a count cell). English keeps the plain digits it
 * always had, with no grouping; Bengali gets Bengali digits.
 */
export function numberText(value: number, locale: Locale): string {
  return locale === 'bn' ? formatNumber(value, locale) : String(value);
}
