/**
 * Calendar files, the thin web layer over `@visastack/core/calendar` (ADR 0016, "Calendar
 * export"). The core holds the one serializer, the kinds registry, the options, the UID and
 * SEQUENCE rules; this file only turns VisaStack records into provider-neutral events.
 *
 * - `buildIcsForAppointment`: one appointment, from its case page (Commercial V1 Part 4 section
 *   11). Keeps its title, place and channel, as before.
 * - `selectCalendarEvents` and `buildIcsCalendar`: the traveller's chosen dates, with generic
 *   titles, no place and no detail. The preview and the file both come from these.
 *
 * Moments are written in UTC, converted from the stored wall-clock time and IANA zone, so every
 * calendar app shows the time the person meant without a VTIMEZONE block. A stored zone this
 * runtime does not recognise makes the appointment an all-day event on its local date rather than
 * a guessed time.
 */

import { formatReferenceCode, parseReferenceCode } from '@visastack/core';
import {
  CALENDAR_KINDS,
  type CalendarEvent,
  type CalendarExportOptions,
  type CalendarKind,
  type CalendarStart,
  calendarSequence,
  calendarUid,
  serializeCalendar,
  utcToWallClock,
  wallClockToUtc,
} from '@visastack/core/calendar';
import type { CalendarItem, CalendarItemWhen } from '@visastack/services';
import { containsUnsafeDetail } from '../app/app/agency/[orgId]/follow-up-message';

export interface IcsAppointment {
  readonly id: string;
  readonly title: string;
  /** Wall-clock local value; interpreted in `timezone`, never shifted by the server. */
  readonly localDateTime: Date;
  readonly timezone: string;
  readonly place: string | null;
  readonly channel: string | null;
  /** Minutes; appointments have no stored end time, so this only sizes the calendar block. */
  readonly durationMinutes?: number;
  /** When the appointment last changed, for SEQUENCE; the file's own time when not given. */
  readonly updatedAt?: Date;
  /**
   * The appointment's own status. A cancelled appointment is written as STATUS:CANCELLED, so
   * importing its file removes or strikes the copy already in a calendar instead of bringing it
   * back. Open, started and done ones are CONFIRMED: a done appointment happened, and stays.
   */
  readonly status?: string;
}

/** `YYYY-MM-DDTHH:MM:SS` from a stored timezone-naive value (read in a UTC process). */
function wallClockOf(value: Date): string {
  return value.toISOString().slice(0, 19);
}

/** The start of a timed item: a UTC moment, or its local day when the zone is not known. */
function timedStart(localDateTime: string, timeZone: string | null): CalendarStart {
  const utc = timeZone ? wallClockToUtc(localDateTime, timeZone) : null;
  return utc && timeZone
    ? { kind: 'instant', utc, timeZone }
    : { kind: 'date', date: localDateTime.slice(0, 10) };
}

function endFor(kind: CalendarKind, start: CalendarStart, minutes?: number) {
  return {
    kind: 'duration' as const,
    minutes:
      start.kind === 'date' ? 1440 : (minutes ?? CALENDAR_KINDS[kind].defaultDurationMinutes),
  };
}

/** A complete single-event file for one appointment. */
export function buildIcsForAppointment(
  appt: IcsAppointment,
  options: { readonly now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const start = timedStart(wallClockOf(appt.localDateTime), appt.timezone);
  const event: CalendarEvent = {
    uid: calendarUid('appointment', appt.id),
    sequence: calendarSequence(appt.updatedAt ?? now),
    status: appt.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
    start,
    end: endFor('appointment', start, appt.durationMinutes),
    title: appt.title,
    ...(appt.channel ? { description: `Channel: ${appt.channel}` } : {}),
    ...(appt.place ? { location: appt.place } : {}),
    privacy: 'private',
    categories: [CALENDAR_KINDS.appointment.category],
    source: { kind: 'appointment', key: `appointment:${appt.id}` },
  };
  return serializeCalendar([event], { now });
}

// --- Several dated items in one file (v1.2 B05 calendar export) ------------------------------

/** The most events one calendar file holds; the earliest selected dates are kept. */
export const CALENDAR_EXPORT_LIMIT = 100;

/** The generic line every exported event carries: no link, no id, no detail. */
export const CALENDAR_EVENT_DESCRIPTION = 'From VisaStack. Open VisaStack for the details.';

/**
 * A dated item, with its case's visible code (`C-7K2Q9M`, ADR 0018) when the item belongs to a
 * case that has one. The code is optional and never part of the UID.
 */
export type CalendarItemWithReference = CalendarItem & {
  readonly caseReference?: string | null;
};

/**
 * The event's description: the generic line, plus "Case reference C-7K2Q9M" when the item's case
 * has a visible code (owner decision 26 Oct 2026). Only a well-formed case code with a correct
 * check character is written; anything else leaves the generic line alone, so no other text can
 * reach a calendar this way.
 */
export function calendarEventDescription(caseReference: string | null | undefined): string {
  if (!caseReference) return CALENDAR_EVENT_DESCRIPTION;
  const parsed = parseReferenceCode(caseReference, 'C');
  if (!parsed.ok) return CALENDAR_EVENT_DESCRIPTION;
  return `From VisaStack. Case reference ${formatReferenceCode('C', parsed.code)}. Open VisaStack for the details.`;
}

/** The download's file name: generic, never a person, a case or an id. */
export const CALENDAR_FILE_NAME = 'visastack-dates.ics';

/** The name some calendar apps show for the imported set. */
export const CALENDAR_NAME = 'VisaStack Dates';

// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;
/** Bidirectional controls (embeddings, overrides, isolates and marks) that can disguise text. */
const BIDI = new RegExp(
  `[${[
    0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ]
    .map((code) => String.fromCodePoint(code))
    .join('')}]`,
  'g',
);
/** Figure, en, em and horizontal bar dashes, the minus sign and the two- and three-em dashes. */
const LONG_DASHES = new RegExp(
  `[${[0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0x2e3a, 0x2e3b, 0xfe58]
    .map((code) => String.fromCodePoint(code))
    .join('')}]`,
  'g',
);
/** U+FFFD, written in place of a lone surrogate. */
const REPLACEMENT = String.fromCodePoint(0xfffd);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Longest case name in a title, in characters. */
const CASE_NAME_MAX = 80;

/**
 * A case title made safe to sit in someone's calendar, or null to leave it out. Control and
 * bidirectional characters are dropped, long dashes become hyphens, it is cut at 80 characters
 * (never inside one), and a name that holds a link, an email address, an id or a long or grouped
 * number in any script is left out whole: the agency follow-up message's own check
 * (`containsUnsafeDetail`), so the two never disagree.
 */
export function calendarCaseName(title: string): string | null {
  const cleaned = Array.from(
    title
      .replace(LONE_SURROGATE, REPLACEMENT)
      .replace(CONTROL, ' ')
      .replace(BIDI, '')
      .replace(LONG_DASHES, '-')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, CASE_NAME_MAX)
    .join('')
    .trim();
  if (cleaned.length === 0 || containsUnsafeDetail(cleaned)) return null;
  return cleaned;
}

/**
 * The event title: the kind's generic title from the registry, plus " - <case name>" only when
 * the person chose case names and the item belongs to a case whose name is safe to show.
 */
export function calendarEventTitle(
  item: Pick<CalendarItem, 'kind' | 'caseTitle'>,
  options: Pick<CalendarExportOptions, 'titleStyle'>,
): string {
  const generic = CALENDAR_KINDS[item.kind].title;
  if (options.titleStyle !== 'withCaseNames' || !item.caseTitle) return generic;
  const caseName = calendarCaseName(item.caseTitle);
  return caseName ? `${generic} - ${caseName}` : generic;
}

function startFor(kind: CalendarKind, when: CalendarItemWhen): CalendarStart {
  if (when.kind === 'date') return { kind: 'date', date: when.date };
  return CALENDAR_KINDS[kind].timing === 'timed'
    ? timedStart(when.localDateTime, when.timeZone)
    : { kind: 'date', date: when.localDateTime.slice(0, 10) };
}

/** One server item as a provider-neutral event, under the person's options. */
export function calendarEventFor(
  item: CalendarItemWithReference,
  options: CalendarExportOptions,
): CalendarEvent {
  const start = startFor(item.kind, item.when);
  const kind = CALENDAR_KINDS[item.kind];
  return {
    uid: calendarUid(item.kind, item.resourceId),
    sequence: calendarSequence(item.updatedAt),
    status: 'CONFIRMED',
    start,
    end: endFor(item.kind, start),
    title: calendarEventTitle(item, options),
    // The case code only when the person chose to show case names: generic titles stay generic.
    description: calendarEventDescription(
      options.titleStyle === 'withCaseNames' ? item.caseReference : null,
    ),
    privacy: 'private',
    categories: [kind.category],
    ...(options.alarms.length > 0
      ? { alarms: options.alarms.map((minutesBefore) => ({ minutesBefore })) }
      : {}),
    source: { kind: item.kind, key: item.key },
  };
}

/**
 * The events for the selected keys, rebuilt from the server's own items under the options: a key
 * the server did not list (another person's, a made-up one, a repeat, or one finished since the
 * preview) is ignored, and every title and date comes from the items, never from the request.
 * Each key is used once, in the items' date order, at most `CALENDAR_EXPORT_LIMIT`; `leftOut`
 * counts the selected ones over the cap. The preview and the file both come from this.
 */
export function selectCalendarEvents(
  items: readonly CalendarItemWithReference[],
  keys: Iterable<string>,
  options: CalendarExportOptions,
): { readonly events: CalendarEvent[]; readonly leftOut: number } {
  const wanted = new Set(keys);
  const kinds = new Set(options.kinds);
  const chosen = items.filter((item) => kinds.has(item.kind) && wanted.delete(item.key));
  return {
    events: chosen.slice(0, CALENDAR_EXPORT_LIMIT).map((item) => calendarEventFor(item, options)),
    leftOut: Math.max(0, chosen.length - CALENDAR_EXPORT_LIMIT),
  };
}

/** The calendar file for the chosen events; `calendarName` replaces the general name. */
export function buildIcsCalendar(
  events: readonly CalendarEvent[],
  options: { readonly now?: Date; readonly calendarName?: string } = {},
): string {
  return serializeCalendar(events, {
    now: options.now ?? new Date(),
    calendarName: options.calendarName ?? CALENDAR_NAME,
  });
}

/**
 * The name a subscribed calendar shows, "VisaStack Dates, Nazmus", so two travellers' calendars can
 * be told apart: the first word of the traveller's name, cleaned like a case name (and left out
 * whole if it holds a number, a link or an address), cut at 40 characters.
 */
export function calendarFeedName(displayName: string): string {
  const first = calendarCaseName(displayName)?.split(' ')[0];
  const name = first ? Array.from(first).slice(0, 40).join('') : '';
  return name ? `${CALENDAR_NAME}, ${name}` : CALENDAR_NAME;
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

function dayName(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  return `${WEEKDAYS[value.getUTCDay()]} ${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
}

/**
 * How a page words when an item happens, for example "Tue 3 Nov 2026, all day" or
 * "Tue 3 Nov 2026, 09:30 Asia/Dhaka time": the same day and clock time the calendar will show
 * in that zone.
 */
export function describeCalendarStart(event: Pick<CalendarEvent, 'start' | 'source'>): string {
  const { start } = event;
  if (start.kind === 'date') {
    const unknownZone = CALENDAR_KINDS[event.source.kind].timing === 'timed';
    return `${dayName(start.date)}, all day${unknownZone ? ' (time zone not recorded)' : ''}`;
  }
  const local = start.timeZone ? utcToWallClock(start.utc, start.timeZone) : null;
  return local
    ? `${dayName(local.date)}, ${local.time} ${start.timeZone} time`
    : `${dayName(start.utc.slice(0, 10))}, ${start.utc.slice(11, 16)} UTC`;
}

/** How a page words when an item from the server happens, before it becomes an event. */
export function describeCalendarItem(item: CalendarItem): string {
  return describeCalendarStart({
    start: startFor(item.kind, item.when),
    source: { kind: item.kind, key: item.key },
  });
}
