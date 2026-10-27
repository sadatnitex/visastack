/**
 * Reading the date boxes on the case forms (Start a Case and Start a New Case from This One), so
 * both refuse an impossible date the same way and in the same words. A date box sends a calendar
 * day as YYYY-MM-DD; anything else, or a day that does not exist (30 February), is refused rather
 * than dropped or rolled into the next month.
 */

export const CASE_DATE_FIELDS = ['travelStartDate', 'travelEndDate', 'targetDeadline'] as const;

export type CaseDateField = (typeof CASE_DATE_FIELDS)[number];

/** Each date box's name, for a message that has to say which one is wrong. */
export const CASE_DATE_LABELS: Readonly<Record<CaseDateField, string>> = {
  travelStartDate: 'Travel Start Date',
  travelEndDate: 'Travel End Date',
  targetDeadline: 'Target Deadline',
};

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
