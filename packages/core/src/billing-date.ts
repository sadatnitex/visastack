/**
 * The one date style of billing (S30): day, short month, year, as "8 Nov 2026", on the Bangladesh
 * calendar, where billing days are counted (ADR 0020). Used by the billing screens, receipts,
 * invoice and receipt documents and billing emails, so a date reads the same everywhere.
 *
 * Built from the date's parts, never from a locale's whole pattern, so every server and browser
 * writes the same text (some runtimes write "Sept"). A due date stored as UTC midnight of a day
 * reads as that same day in Bangladesh (UTC+6).
 *
 * Pure and framework-free: safe to import in the browser.
 */

/** The calendar billing days are counted in. */
export const BILLING_CALENDAR_TIME_ZONE = 'Asia/Dhaka';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface DayParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function partsOf(at: Date, timeZone: string): DayParts | null {
  if (Number.isNaN(at.getTime())) return null;
  const read = (zone: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  let found: Intl.DateTimeFormatPart[];
  try {
    found = read(timeZone);
  } catch {
    found = read('UTC');
  }
  const part = (type: string) => Number(found.find((p) => p.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour') % 24,
    minute: part('minute'),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "8 Nov 2026": the Bangladesh day of a date or a moment. An unreadable value gives "". */
export function formatBillingDate(
  value: Date | string,
  timeZone: string = BILLING_CALENDAR_TIME_ZONE,
): string {
  const parts = partsOf(toDate(value), timeZone);
  if (!parts) return '';
  return `${parts.day} ${MONTHS[parts.month - 1] ?? ''} ${parts.year}`;
}

/** "8 Nov 2026, 14:05": a moment with its Bangladesh time (24-hour clock). */
export function formatBillingDateTime(
  value: Date | string,
  timeZone: string = BILLING_CALENDAR_TIME_ZONE,
): string {
  const parts = partsOf(toDate(value), timeZone);
  if (!parts) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parts.day} ${MONTHS[parts.month - 1] ?? ''} ${parts.year}, ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Whole Bangladesh calendar days from `now` to the day of `value`: 0 on the same day, 1 for
 * tomorrow, negative once it has passed.
 */
export function billingDaysUntil(value: Date | string, now: Date = new Date()): number {
  const a = partsOf(toDate(value), BILLING_CALENDAR_TIME_ZONE);
  const b = partsOf(now, BILLING_CALENDAR_TIME_ZONE);
  if (!a || !b) return 0;
  const day = (p: DayParts) => Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
  return Math.round(day(a) - day(b));
}
