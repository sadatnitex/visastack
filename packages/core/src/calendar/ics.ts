import {
  ALL_DAY_ALARM_MINUTE_OF_DAY,
  type CalendarEnd,
  type CalendarEvent,
  type CalendarStart,
} from './model';

/**
 * The one iCalendar (RFC 5545) serializer. Pure: the caller passes the clock. Every VisaStack
 * calendar file goes through it, so escaping, folding and the privacy rules live in one place.
 *
 * Each event: UID, SEQUENCE, DTSTAMP (UTC), DTSTART and DTEND (VALUE=DATE for a day, UTC with
 * "Z" for a moment, so no VTIMEZONE block is needed), SUMMARY, DESCRIPTION and LOCATION when
 * given, CLASS:PRIVATE, STATUS, CATEGORIES, TRANSP:TRANSPARENT for a day (a due date does not
 * make anyone busy), and one VALARM per reminder. The calendar: VERSION, PRODID, CALSCALE,
 * METHOD:PUBLISH and, when given, X-WR-CALNAME.
 *
 * Every value is cleaned before it is written: line breaks and other control characters can
 * never start a new property, a lone surrogate becomes U+FFFD, and long dashes become hyphens.
 * Lines end with CRLF and fold at 75 octets of UTF-8 without splitting a character.
 */

export const CALENDAR_PRODID = '-//VisaStack//Calendar//EN';

export interface SerializeCalendarOptions {
  /** DTSTAMP: when the file was made. */
  readonly now: Date;
  /** X-WR-CALNAME, the name some calendar apps show for an imported set. */
  readonly calendarName?: string;
}

const DAY_MS = 86_400_000;

/** U+FFFD, written in place of a lone surrogate. */
const REPLACEMENT = String.fromCodePoint(0xfffd);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/**
 * C0 controls except tab and line feed, DEL, and C1 controls (U+0080 to U+009F, including NEL),
 * removed once line breaks are normalised.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
/** CRLF, a lone CR, LF, NEL and the Unicode line and paragraph separators: all one line break. */
const LINE_BREAK = new RegExp(`\\r\\n|[\\r\\n${String.fromCodePoint(0x85, 0x2028, 0x2029)}]`, 'g');
/** Figure, en, em and horizontal bar dashes, the minus sign and the two- and three-em dashes. */
const LONG_DASHES = new RegExp(
  `[${[0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0x2e3a, 0x2e3b, 0xfe58]
    .map((code) => String.fromCodePoint(code))
    .join('')}]`,
  'g',
);

/**
 * Well-formed, dash-normalised text whose every line break is a plain LF and which holds no
 * other control character except tab.
 */
function clean(value: string): string {
  return value
    .replace(LONE_SURROGATE, REPLACEMENT)
    .replace(LONG_DASHES, '-')
    .replace(LINE_BREAK, '\n')
    .replace(CONTROL, '');
}

/** A TEXT value (RFC 5545 3.3.11): backslash, semicolon, comma escaped; each line break as "\n". */
export function escapeText(value: string): string {
  return clean(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, ' ');
}

/** A value that is not TEXT (UID, dates): a line break or tab becomes a space; no control is left. */
function plainValue(value: string): string {
  return clean(value).replace(/[\n\t]/g, ' ');
}

function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/** Folds one content line at 75 octets; each continuation starts with one space (74 more octets). */
export function foldLine(line: string): string {
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
      limit = 74;
    }
    current += char;
    size += length;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYYMMDDTHHMMSSZ`. */
function utcStamp(instant: number): string {
  const d = new Date(instant);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function dayIndex(date: string): number {
  const at = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(at)) {
    throw new RangeError('calendar date must be YYYY-MM-DD');
  }
  return at / DAY_MS;
}

function instantOf(start: CalendarStart & { kind: 'instant' }): number {
  const at = Date.parse(start.utc);
  if (Number.isNaN(at)) throw new RangeError('calendar instant must be ISO 8601');
  return Math.floor(at / 1000) * 1000;
}

function dateValue(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10).replace(/-/g, '');
}

/** DTSTART and DTEND. A day ends on a later day; a moment ends at a later moment. */
function timeLines(start: CalendarStart, end: CalendarEnd): string[] {
  if (start.kind === 'date') {
    const from = dayIndex(start.date);
    const to =
      end.kind === 'date'
        ? dayIndex(end.date)
        : end.kind === 'duration'
          ? from + Math.ceil(end.minutes / 1440)
          : from + 1;
    return [
      `DTSTART;VALUE=DATE:${dateValue(from)}`,
      `DTEND;VALUE=DATE:${dateValue(Math.max(to, from + 1))}`,
    ];
  }
  const from = instantOf(start);
  const to =
    end.kind === 'instant'
      ? instantOf(end)
      : end.kind === 'duration'
        ? from + end.minutes * 60_000
        : from + 60 * 60_000;
  return [`DTSTART:${utcStamp(from)}`, `DTEND:${utcStamp(Math.max(to, from))}`];
}

/** A signed RFC 5545 duration in minutes: -PT15M, PT540M. */
function durationValue(minutes: number): string {
  const whole = Math.trunc(minutes);
  return `${whole < 0 ? '-' : ''}PT${Math.abs(whole)}M`;
}

function alarmLines(event: CalendarEvent): string[] {
  // An all-day event starts at midnight; its reminder fires at 09:00 that many whole days before.
  // Two reminders that land on the same moment (15 and 60 minutes before a day) are written once.
  const triggers = [
    ...new Set(
      (event.alarms ?? []).map((alarm) => {
        const before = Math.max(0, Math.trunc(alarm.minutesBefore));
        return event.start.kind === 'date'
          ? durationValue(ALL_DAY_ALARM_MINUTE_OF_DAY - Math.floor(before / 1440) * 1440)
          : durationValue(-before);
      }),
    ),
  ];
  return triggers.flatMap((trigger) => [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:${trigger}`,
    `DESCRIPTION:${escapeText(event.title)}`,
    'END:VALARM',
  ]);
}

function eventLines(event: CalendarEvent, stamp: string): string[] {
  const categories = (event.categories ?? []).map(escapeText).filter((c) => c.length > 0);
  return [
    'BEGIN:VEVENT',
    `UID:${plainValue(event.uid)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(event.sequence))}`,
    `DTSTAMP:${stamp}`,
    ...timeLines(event.start, event.end),
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    'CLASS:PRIVATE',
    `STATUS:${event.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(categories.length > 0 ? [`CATEGORIES:${categories.join(',')}`] : []),
    ...(event.start.kind === 'date' ? ['TRANSP:TRANSPARENT'] : []),
    ...alarmLines(event),
    'END:VEVENT',
  ];
}

/** A complete calendar file for the events, in the order given. */
export function serializeCalendar(
  events: readonly CalendarEvent[],
  options: SerializeCalendarOptions,
): string {
  const stamp = utcStamp(Math.floor(options.now.getTime() / 1000) * 1000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${CALENDAR_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(options.calendarName ? [`X-WR-CALNAME:${escapeText(options.calendarName)}`] : []),
    ...events.flatMap((event) => eventLines(event, stamp)),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
