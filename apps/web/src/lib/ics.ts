/**
 * A minimal iCalendar (RFC 5545) VEVENT generator for one appointment.
 * Commercial V1 Part 4 §11: "Appointment: ... add-to-calendar file/download.
 * No calendar SaaS integration required." - a real, importable .ics file is
 * sufficient; no Google/Outlook API integration is in scope.
 *
 * Uses a bare `DTSTART;TZID=<iana>` referencing the zone by name rather than
 * embedding a full VTIMEZONE block: every mainstream calendar app (Google
 * Calendar, Outlook, Apple Calendar) resolves a recognized IANA id this way,
 * and the PRD's own "no calendar SaaS integration required" sets the bar at
 * "importable," not "valid against every RFC 5545 conformance test."
 */

import type { CalendarItem, CalendarWhen } from '@visastack/services';
import { CALENDAR_EVENT_TITLES } from './labels';

/** Escape text per RFC 5545 §3.3.11: backslash, semicolon, comma, then newlines to literal \n. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * `YYYYMMDDTHHMMSS`, from a wall-clock local date/time. Deliberately reads
 * the UTC-getter methods, not the local ones: this process runs with TZ=UTC
 * (see schema.ts's `localDateTime` doc comment for why that makes the two
 * equivalent here), so `getUTCHours()` etc. return the exact wall-clock
 * numbers that were stored, with no conversion in either direction.
 */
function formatLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/** `YYYYMMDDTHHMMSSZ`, a genuine UTC instant (used only for DTSTAMP, "when this file was generated"). */
function formatUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export interface IcsAppointment {
  readonly id: string;
  readonly title: string;
  /** Wall-clock local value; interpreted in `timezone`, never converted. */
  readonly localDateTime: Date;
  readonly timezone: string;
  readonly place: string | null;
  readonly channel: string | null;
  /** Minutes; appointments have no stored end time, so this only sizes the calendar block. */
  readonly durationMinutes?: number;
}

/** Builds a complete, single-event .ics file. */
export function buildIcsForAppointment(appt: IcsAppointment): string {
  const duration = appt.durationMinutes ?? 60;
  const end = new Date(appt.localDateTime.getTime() + duration * 60_000);
  const descriptionParts = [appt.channel ? `Channel: ${appt.channel}` : null].filter(
    (p): p is string => p !== null,
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VisaStack//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:appointment-${appt.id}@visastack`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART;TZID=${appt.timezone}:${formatLocal(appt.localDateTime)}`,
    `DTEND;TZID=${appt.timezone}:${formatLocal(end)}`,
    `SUMMARY:${escapeIcsText(appt.title)}`,
    ...(appt.place ? [`LOCATION:${escapeIcsText(appt.place)}`] : []),
    ...(descriptionParts.length > 0
      ? [`DESCRIPTION:${escapeIcsText(descriptionParts.join('\n'))}`]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // RFC 5545 requires CRLF line endings.
  return `${lines.join('\r\n')}\r\n`;
}

// --- Several dated items in one file (v1.2 B05 calendar export, ADR 0016) -------------------

/** The most events one calendar file holds; the earliest selected dates are kept. */
export const CALENDAR_EXPORT_LIMIT = 100;

/** The one generic line every exported event carries: no link, no id, no detail. */
export const CALENDAR_EVENT_DESCRIPTION = 'From VisaStack. Open VisaStack for the details.';

/** The download's file name: generic, never a person, a case or an id. */
export const CALENDAR_FILE_NAME = 'visastack-dates.ics';

/** One event in a multi-event file, already named. */
export interface IcsCalendarEvent {
  /** `${kind}:${resourceId}`, the item key; the UID is made from it. */
  readonly key: string;
  readonly summary: string;
  readonly when: CalendarWhen;
}

/** A stable UID for an item key: `<kind>-<id>@visastack`, so a re-import updates, not duplicates. */
export function icsUid(key: string): string {
  return `${key.replace(':', '-').replace(/[^A-Za-z0-9_-]/g, '-')}@visastack`;
}

/** A word or code holding six or more digits in a row, such as a passport or account number. */
const LONG_NUMBER = /[A-Za-z0-9]*\d{6,}[A-Za-z0-9]*/g;

/**
 * A case title made safe to sit in someone's calendar: control characters dropped, long dashes
 * turned into hyphens, anything holding a long run of digits hidden, and the length capped.
 */
export function calendarCaseName(title: string): string {
  return (
    title
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/[–—―]/g, '-')
      .replace(LONG_NUMBER, '(number hidden)')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  );
}

/**
 * The event title: the generic name for the kind, plus " - <case title>" only when the person
 * asked for case names and the item belongs to a case.
 */
export function calendarEventTitle(
  item: Pick<CalendarItem, 'kind' | 'caseTitle'>,
  options: { readonly caseNames: boolean },
): string {
  const generic = CALENDAR_EVENT_TITLES[item.kind];
  const caseName = options.caseNames && item.caseTitle ? calendarCaseName(item.caseTitle) : '';
  return caseName ? `${generic} - ${caseName}` : generic;
}

/**
 * The events for the selected keys, rebuilt from the server's own items: a key the server did
 * not list (another person's, a made-up one, a repeat) is ignored, and every title and date comes
 * from the items, never from the request. Each key is used once, in the items' date order, at most
 * `CALENDAR_EXPORT_LIMIT`; `leftOut` counts the selected ones over the cap. The preview and the
 * file both come from this, so the preview shows exactly what the file holds.
 */
export function selectCalendarEvents(
  items: readonly CalendarItem[],
  keys: Iterable<string>,
  options: { readonly caseNames: boolean },
): { readonly events: IcsCalendarEvent[]; readonly leftOut: number } {
  const wanted = new Set(keys);
  const chosen = items.filter((item) => wanted.delete(item.key));
  return {
    events: chosen.slice(0, CALENDAR_EXPORT_LIMIT).map((item) => ({
      key: item.key,
      summary: calendarEventTitle(item, options),
      when: item.when,
    })),
    leftOut: Math.max(0, chosen.length - CALENDAR_EXPORT_LIMIT),
  };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS` wall-clock value as a Date whose UTC fields are it. */
function wallClock(value: string): Date {
  return new Date(value.length === 10 ? `${value}T00:00:00.000Z` : `${value}.000Z`);
}

/**
 * How the preview words a date, for example "Tue 3 Nov 2026, all day" or
 * "Tue 3 Nov 2026, 09:30 Asia/Dhaka time". Never converted: the same wall clock as the file.
 */
export function describeCalendarWhen(when: CalendarWhen): string {
  const date = wallClock(when.kind === 'date' ? when.date : when.localDateTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  if (when.kind === 'date') return `${day}, all day`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return when.timezone
    ? `${day}, ${time} ${when.timezone} time`
    : `${day}, ${time} (time zone not recorded, so your calendar's own)`;
}

/** UTF-8 length of one code point. */
function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * Folds one content line (RFC 5545 section 3.1): no line longer than 75 octets counted in UTF-8,
 * each continuation starting with one space, and never splitting a character.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const length = utf8Length(char);
    if (size + length > limit) {
      parts.push(current);
      current = '';
      size = 0;
      // A continuation line holds 74 octets after its leading space.
      limit = 74;
    }
    current += char;
    size += length;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** `YYYYMMDD` for a `YYYY-MM-DD` day, and the day after it (an all-day event's exclusive end). */
function icsDate(date: string, addDays = 0): string {
  const value = new Date(wallClock(date).getTime() + addDays * 86_400_000);
  return value.toISOString().slice(0, 10).replace(/-/g, '');
}

/** The DTSTART and DTEND lines for one event. */
function eventTimes(when: CalendarWhen): string[] {
  if (when.kind === 'date') {
    return [
      `DTSTART;VALUE=DATE:${icsDate(when.date)}`,
      `DTEND;VALUE=DATE:${icsDate(when.date, 1)}`,
      // A due day or expiry day does not make the person busy.
      'TRANSP:TRANSPARENT',
    ];
  }
  const start = wallClock(when.localDateTime);
  const end = new Date(start.getTime() + 60 * 60_000);
  // A zone name is used only if it is a plain IANA name (letters, digits, "_", "+", "-", "/").
  // Without one the time is floating: the same clock time wherever the calendar is.
  const zone =
    when.timezone && /^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(when.timezone)
      ? `;TZID=${when.timezone}`
      : '';
  return [`DTSTART${zone}:${formatLocal(start)}`, `DTEND${zone}:${formatLocal(end)}`];
}

/**
 * A complete calendar file with one event per item (RFC 5545): VCALENDAR with VERSION, PRODID,
 * CALSCALE and METHOD:PUBLISH; each VEVENT with a stable UID from its key, DTSTAMP in UTC, an
 * all-day span for a date (DTEND the next day) or the stored wall-clock time with its TZID for an
 * appointment (one hour long, as the single-appointment file), the title, and the one generic
 * description line. Like `buildIcsForAppointment` it names the zone by its IANA id without a
 * VTIMEZONE block; calendar apps resolve the name. Text is escaped, lines are folded at 75
 * octets, and every line ends with CRLF.
 */
export function buildIcsCalendar(
  events: readonly IcsCalendarEvent[],
  options: { readonly now?: Date } = {},
): string {
  const stamp = formatUtc(options.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VisaStack//Calendar Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${icsUid(event.key)}`,
      `DTSTAMP:${stamp}`,
      ...eventTimes(event.when),
      `SUMMARY:${escapeIcsText(event.summary)}`,
      `DESCRIPTION:${escapeIcsText(CALENDAR_EVENT_DESCRIPTION)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
