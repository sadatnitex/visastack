import type { CalendarKind } from './kinds';

/**
 * The provider-neutral calendar event. Every way VisaStack hands dates to a calendar (a one-time
 * file today; a live feed or a Google or Microsoft adapter later, see `port.ts`) is built from
 * this one shape, so a new destination never needs a new model.
 */

/** A calendar day, `YYYY-MM-DD`: an all-day event, the same day in every time zone. */
export interface CalendarDate {
  readonly kind: 'date';
  readonly date: string;
}

/**
 * A moment, as UTC (`YYYY-MM-DDTHH:MM:SSZ` or any ISO 8601 instant). `timeZone` is the IANA zone
 * the person meant, kept for display and for destinations that store a zone; the file format
 * itself always writes UTC, which every calendar app shows in the reader's own zone.
 */
export interface CalendarInstant {
  readonly kind: 'instant';
  readonly utc: string;
  readonly timeZone?: string;
}

export type CalendarStart = CalendarDate | CalendarInstant;

/** An explicit end, or a length from the start (whole days for a date, minutes for an instant). */
export type CalendarEnd = CalendarStart | { readonly kind: 'duration'; readonly minutes: number };

export interface CalendarAlarm {
  /**
   * Minutes before the event. For an all-day event the reminder fires at
   * `ALL_DAY_ALARM_MINUTE_OF_DAY` on the day that many minutes before, never at midnight.
   */
  readonly minutesBefore: number;
}

export interface CalendarEvent {
  /** Permanent and opaque (`uid.ts`). The same thing always has the same UID. */
  readonly uid: string;
  /** Bigger means newer (`sequence.ts`): a calendar keeps the copy with the highest number. */
  readonly sequence: number;
  readonly status: 'CONFIRMED' | 'CANCELLED';
  readonly start: CalendarStart;
  readonly end: CalendarEnd;
  readonly title: string;
  readonly description?: string;
  /** Where, for an appointment the person exports on its own. Never set by the dates export. */
  readonly location?: string;
  /** Always private for now: written as CLASS:PRIVATE so shared calendars hide the details. */
  readonly privacy: 'private';
  readonly categories?: readonly string[];
  readonly alarms?: readonly CalendarAlarm[];
  /** Traceability inside VisaStack only (which kind and record). Never written to a file. */
  readonly source: { readonly kind: CalendarKind; readonly key: string };
}

/** An all-day reminder fires at 09:00 on its day (minutes after midnight). */
export const ALL_DAY_ALARM_MINUTE_OF_DAY = 9 * 60;
