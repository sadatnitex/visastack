import { type Locale, formatDate } from '@visastack/i18n';
import { formatTimestampDate } from '../../../../lib/format-date';

/**
 * A real moment shown as a day, for example "6 Oct 2026". English keeps the exact text it always
 * had; Bengali readers get Bengali digits and month names.
 */
export function dayLabel(value: string | Date, locale: Locale): string {
  if (locale === 'bn') {
    return formatDate(new Date(value), locale, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return formatTimestampDate(value);
}
