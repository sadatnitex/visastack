import type { Locale } from './messages';

/** BCP 47 tag used for formatting. English is formatted en-GB, as the product does today. */
export function localeTag(locale: Locale): string {
  return locale === 'bn' ? 'bn-BD' : 'en-GB';
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(localeTag(locale), options).format(value);
}

export function formatDate(
  date: Date | number,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(localeTag(locale), options).format(date);
}

/**
 * Amounts always keep the ISO code beside the number (for example "BDT 1,200.00"):
 * never a symbol, never converted (owner decision 2026-11-12).
 */
export function formatMoney(amount: number, currencyCode: string, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), {
    style: 'currency',
    currency: currencyCode,
    currencyDisplay: 'code',
  }).format(amount);
}
