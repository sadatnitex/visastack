/**
 * UMPE G1: what one file shows the moment it is read (ledger I08, I14). Pure: no database, so every
 * rule is tested on its own.
 *
 * - No readable text: the reading failed, or found fewer than a sentence's worth of letters and
 *   digits. The person is told once, so a blank scan or a photo of a wall is not silently kept.
 * - Expired on arrival: the document's expiry day (saved, or read from a passport's check-digit
 *   verified lines) is before the day the file was added, in the person's own time zone.
 * - Statement period for a proposed name: "March 2026" for a whole calendar month, otherwise
 *   "1 Mar 2026 to 31 Mar 2026". Only from the file's own text (`readStatementPeriod`).
 */

import {
  PERIOD_DOCUMENT_TYPES,
  type StatementPeriod,
  readStatementPeriod,
} from './umpe-document-relations';

export const INTAKE_EXCEPTION_KINDS = ['EXPIRED_ON_ARRIVAL', 'NO_READABLE_TEXT'] as const;
export type IntakeExceptionKind = (typeof INTAKE_EXCEPTION_KINDS)[number];

export function isIntakeExceptionKind(value: unknown): value is IntakeExceptionKind {
  return typeof value === 'string' && (INTAKE_EXCEPTION_KINDS as readonly string[]).includes(value);
}

/** Fewer letters and digits than this, and the file counts as having no readable text. */
export const MIN_READABLE_CHARACTERS = 20;

/** True when the text holds at least a sentence's worth of letters or digits. */
export function hasReadableText(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  const count = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return count >= MIN_READABLE_CHARACTERS;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** The calendar day of a moment in a time zone, as YYYY-MM-DD. Falls back to UTC for an unknown zone. */
export function calendarDay(moment: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(moment);
  } catch {
    return moment.toISOString().slice(0, 10);
  }
}

/**
 * True when the expiry day is before the day the file was added. An expiry kept as a moment is
 * read as its UTC day (expiry dates are stored at midnight UTC); a string must start YYYY-MM-DD.
 * Nothing known, nothing raised.
 */
export function expiredOnArrival(
  expiry: Date | string | null | undefined,
  addedAt: Date,
  timeZone: string,
): boolean {
  if (expiry === null || expiry === undefined) return false;
  const day =
    expiry instanceof Date
      ? Number.isNaN(expiry.getTime())
        ? null
        : expiry.toISOString().slice(0, 10)
      : (expiry.match(ISO_DAY)?.[0] ?? null);
  if (day === null) return false;
  return day < calendarDay(addedAt, timeZone);
}

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function parts(isoDay: string): { year: number; month: number; day: number } | null {
  const match = isoDay.match(ISO_DAY);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function shortDay(value: { year: number; month: number; day: number }): string {
  const month = MONTHS_LONG[value.month - 1]?.slice(0, 3) ?? '';
  return `${value.day} ${month} ${value.year}`;
}

/** "March 2026" for a whole calendar month, otherwise "1 Mar 2026 to 31 Mar 2026". */
export function statementPeriodLabel(period: StatementPeriod): string | null {
  const start = parts(period.start);
  const end = parts(period.end);
  if (!start || !end) return null;
  const lastDay = new Date(Date.UTC(end.year, end.month, 0)).getUTCDate();
  if (
    start.year === end.year &&
    start.month === end.month &&
    start.day === 1 &&
    end.day === lastDay
  ) {
    return `${MONTHS_LONG[start.month - 1]} ${start.year}`;
  }
  return `${shortDay(start)} to ${shortDay(end)}`;
}

/** The period to put in a proposed name for a statement kind, from the file's own text, or null. */
export function periodForName(
  text: string | null | undefined,
  docType: string | null,
): string | null {
  if (!text || !docType || !PERIOD_DOCUMENT_TYPES.has(docType)) return null;
  const period = readStatementPeriod(text);
  return period ? statementPeriodLabel(period) : null;
}
