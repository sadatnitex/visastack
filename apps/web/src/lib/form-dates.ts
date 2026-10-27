/**
 * Reading the date boxes on the case forms (Start a Case and Start a New Case from This One), so
 * both refuse a wrong date the same way and in the same words.
 *
 * Each side catches what it can see:
 * - The browser (`usePartTypedDateCheck`): a part-typed date (a day and month with no year, say).
 *   A date box sends nothing at all for one, so only the page can tell it from an empty box; the
 *   form stops, marks the box and moves focus to it.
 * - The server (`readCaseDates`): anything sent that is not a whole calendar day as YYYY-MM-DD, a
 *   day that does not exist (30 February), and a trip that ends before it starts. It is refused,
 *   never dropped or rolled into the next month. Without the page's scripts a part-typed date
 *   still arrives empty and is saved as not given.
 */

export const CASE_DATE_FIELDS = ['travelStartDate', 'travelEndDate', 'targetDeadline'] as const;

export type CaseDateField = (typeof CASE_DATE_FIELDS)[number];

export const DATE_NOT_REAL = 'Enter a full date: day, month and year.';
export const TRIP_ENDS_BEFORE_START = 'The trip cannot end before it starts.';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** One date box: blank is "not given", a real day is that day at midnight UTC, else 'invalid'. */
export function readFormDate(
  value: FormDataEntryValue | string | null,
): Date | 'invalid' | undefined {
  if (value === null) return undefined;
  // A file sent in place of a date is not a date.
  if (typeof value !== 'string') return 'invalid';
  const raw = value.trim();
  if (raw.length === 0) return undefined;
  if (!DATE_ONLY.test(raw)) return 'invalid';
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw
    ? 'invalid'
    : parsed;
}

/** The three case dates: the days given, and a problem for each box that is wrong. */
export function readCaseDates(read: (name: CaseDateField) => FormDataEntryValue | string | null): {
  readonly dates: Readonly<Partial<Record<CaseDateField, Date>>>;
  readonly errors: Readonly<Partial<Record<CaseDateField, string>>>;
} {
  const dates: Partial<Record<CaseDateField, Date>> = {};
  const errors: Partial<Record<CaseDateField, string>> = {};
  for (const name of CASE_DATE_FIELDS) {
    const date = readFormDate(read(name));
    if (date === 'invalid') errors[name] = DATE_NOT_REAL;
    else if (date) dates[name] = date;
  }
  if (
    dates.travelStartDate &&
    dates.travelEndDate &&
    dates.travelEndDate.getTime() < dates.travelStartDate.getTime()
  ) {
    errors.travelEndDate = TRIP_ENDS_BEFORE_START;
  }
  return { dates, errors };
}
