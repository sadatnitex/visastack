import { type Locale, formatTag } from './locales';

/**
 * Locale-aware formatting of counts and dates, and `{token}` interpolation.
 * Pure, with no catalogs, so a client component can use it without shipping any
 * message text (the low-bandwidth rule in directive Part 9 section 3).
 *
 * Only numbers the product computes (counts, sizes, years) pass through
 * `formatNumber`. Anything a person typed or an issuer printed (a name, a
 * passport number, a reference code, a filename) is a string and is never
 * touched: directive Part 9 section 4, "do not machine-transliterate legal
 * names automatically; preserve original Unicode".
 */

/** Interpolation parameters for a message (`{token}` becomes the value). */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * A whole number or decimal written in the locale's digits, with no thousands
 * separator (a year or a count must never read "২,০২৬"). English output is the
 * plain `String(value)` it has always been.
 */
export function formatNumber(locale: Locale, value: number): string {
  if (locale === 'en') return String(value);
  return new Intl.NumberFormat(formatTag(locale), {
    useGrouping: false,
    maximumFractionDigits: 20,
  }).format(value);
}

/** Which plural form of a message to use for `count`, by the locale's own rules (Bangla uses one wording for every count). */
export function pluralForm(locale: Locale, count: number): 'one' | 'other' {
  return new Intl.PluralRules(formatTag(locale)).select(count) === 'one' ? 'one' : 'other';
}

/** Replace `{token}` placeholders; a token with no value is left visible rather than dropped. */
export function fill(template: string, params?: MessageParams, locale: Locale = 'en'): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, token: string) => {
    const value = params[token];
    if (value === undefined) return whole;
    return typeof value === 'number' ? formatNumber(locale, value) : value;
  });
}

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * The calendar zone every date in the product is written in. A date shown on
 * the server and again after hydration must read the same, and the server does
 * not know where the reader is, so the zone is fixed and named rather than
 * guessed. A reader's own zone is a later refinement.
 */
export const DISPLAY_TIME_ZONE = 'UTC';

/**
 * A calendar date ("5 Oct 2026", "৫ অক্টো, ২০২৬"). Pass `style: 'long'` for the
 * spelled-out month. Day-level only: the zone cannot move the date by more than a
 * few hours' worth of ambiguity, and a time of day belongs in `formatDateTime`.
 */
export function formatDate(
  locale: Locale,
  value: DateInput,
  style: 'short' | 'long' = 'short',
): string {
  return new Intl.DateTimeFormat(formatTag(locale), {
    year: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    timeZone: DISPLAY_TIME_ZONE,
  }).format(toDate(value));
}

/** A date with its time of day, always naming the zone ("5 Oct 2026, 23:30 UTC") so it is never mistaken for local time. */
export function formatDateTime(locale: Locale, value: DateInput): string {
  return new Intl.DateTimeFormat(formatTag(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // 24-hour in both languages: it needs no AM/PM (Bangla would otherwise print Latin "PM" mid-sentence)
    // and it is unambiguous.
    hourCycle: 'h23',
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: 'short',
  }).format(toDate(value));
}

/**
 * A date-only value (a field that has no time of day, stored as UTC midnight)
 * rendered as the exact calendar date it was written as. Same output as
 * `formatDate`; the separate name keeps call sites honest about which kind of
 * value they hold (see `apps/web/src/lib/format-date.ts`).
 */
export function formatDateOnly(locale: Locale, iso: string): string {
  return formatDate(locale, iso);
}

/**
 * Splits a message that carries inline emphasis or links into plain and tagged
 * pieces, so a React component can wrap exactly those pieces and nothing else:
 * `"Grant <b>Core processing</b> from <link>Overview</link>."`. Only a fixed
 * set of tag names is recognised and any other angle bracket stays as plain
 * text. The result is data, never markup, so message text cannot inject HTML.
 *
 * Split the TEMPLATE, then `fill` each piece. Filling first would let a value a
 * person typed (a name containing `<b>`) be read as a tag and silently altered.
 */
export interface RichPiece {
  readonly tag: string | null;
  readonly text: string;
}

const RICH_TAGS = ['b', 'link'] as const;

export function splitRich(template: string): readonly RichPiece[] {
  const pieces: RichPiece[] = [];
  const pattern = new RegExp(`<(${RICH_TAGS.join('|')})>([^<]*)</\\1>`, 'g');
  let last = 0;
  for (const match of template.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) pieces.push({ tag: null, text: template.slice(last, index) });
    pieces.push({ tag: match[1] ?? null, text: match[2] ?? '' });
    last = index + match[0].length;
  }
  if (last < template.length) pieces.push({ tag: null, text: template.slice(last) });
  return pieces;
}
