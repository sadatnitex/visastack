import type { Locale } from './messages';

/** BCP 47 tag used for formatting. English is formatted en-GB, as the product does today. */
export function localeTag(locale: Locale): string {
  return locale === 'bn' ? 'bn-BD' : 'en-GB';
}

export type FormatNumberOptions = Intl.NumberFormatOptions & {
  /** English only: group thousands ("1,234"). Off by default, so English stays as String(value). */
  grouping?: boolean;
};

/**
 * Standalone counts. English is exactly String(value) (no grouping), the same as the original
 * English code; pass {grouping: true} where English genuinely needs "1,234". Bengali always uses
 * Bengali digits with the locale grouping. Other Intl options apply to both languages.
 */
export function formatNumber(value: number, locale: Locale, options?: FormatNumberOptions): string {
  if (locale === 'bn') {
    const { grouping: _ignored, ...intl } = options ?? {};
    return new Intl.NumberFormat(localeTag(locale), intl).format(value);
  }
  if (!options) return String(value);
  const { grouping, ...intl } = options;
  return new Intl.NumberFormat(localeTag(locale), {
    ...intl,
    useGrouping: grouping === true ? (intl.useGrouping ?? true) : false,
  }).format(value);
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
