/**
 * The one registry of dated things VisaStack can put in a calendar. Everything that depends on a
 * kind (its generic title, whether it is all-day, how long a timed one lasts, its category) is
 * read from here, and the `CalendarKind` type is derived from the table, so adding a kind is one
 * entry. Titles are generic on purpose: they never name a document, a detail or a number.
 */

export interface CalendarKindDefinition {
  /** The generic event title, in Title Case. */
  readonly title: string;
  /** `all_day`: a calendar day. `timed`: a moment with a length. */
  readonly timing: 'all_day' | 'timed';
  /** How long a timed event lasts when the source has no end time. */
  readonly defaultDurationMinutes: number;
  /** The CATEGORIES value, so a person can filter or colour VisaStack dates in their calendar. */
  readonly category: string;
}

export const CALENDAR_KINDS = {
  appointment: {
    title: 'Appointment',
    timing: 'timed',
    defaultDurationMinutes: 60,
    category: 'VisaStack Appointment',
  },
  task_due: {
    title: 'Task Due',
    timing: 'all_day',
    defaultDurationMinutes: 1440,
    category: 'VisaStack Task',
  },
  request_due: {
    title: 'Request Due',
    timing: 'all_day',
    defaultDurationMinutes: 1440,
    category: 'VisaStack Request',
  },
  document_expires: {
    title: 'Document Expires',
    timing: 'all_day',
    defaultDurationMinutes: 1440,
    category: 'VisaStack Document',
  },
} as const satisfies Readonly<Record<string, CalendarKindDefinition>>;

export type CalendarKind = keyof typeof CALENDAR_KINDS;

/** Every kind, in the registry's order. */
export const CALENDAR_KIND_IDS = Object.keys(CALENDAR_KINDS) as readonly CalendarKind[];

export function isCalendarKind(value: unknown): value is CalendarKind {
  return typeof value === 'string' && Object.hasOwn(CALENDAR_KINDS, value);
}
