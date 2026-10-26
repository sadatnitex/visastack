/**
 * The provider-neutral calendar core (`@visastack/core/calendar`). Kept out of the main
 * `@visastack/core` index on purpose: only the calendar export uses it, so nothing else bundles
 * the serializer or the hash. See ADR 0016, "Calendar export".
 */
export {
  CALENDAR_PRODID,
  type SerializeCalendarOptions,
  escapeText,
  foldLine,
  serializeCalendar,
} from './ics';
export {
  CALENDAR_KINDS,
  CALENDAR_KIND_IDS,
  type CalendarKind,
  type CalendarKindDefinition,
  isCalendarKind,
} from './kinds';
export {
  ALL_DAY_ALARM_MINUTE_OF_DAY,
  type CalendarAlarm,
  type CalendarDate,
  type CalendarEnd,
  type CalendarEvent,
  type CalendarInstant,
  type CalendarStart,
} from './model';
export {
  CALENDAR_ALARM_OFFSETS,
  CALENDAR_MAX_ALARMS,
  CALENDAR_OPTIONS_VERSION,
  CALENDAR_OPTION_FIELDS,
  CALENDAR_TITLE_STYLES,
  type CalendarAlarmOffset,
  type CalendarExportOptions,
  type CalendarOptionsInput,
  type CalendarTitleStyle,
  DEFAULT_CALENDAR_EXPORT_OPTIONS,
  calendarOptionFields,
  parseCalendarExportOptions,
} from './options';
export type { CalendarPublisher } from './port';
export { CALENDAR_SEQUENCE_EPOCH, calendarSequence } from './sequence';
export { sha256Hex } from './sha256';
export { isKnownTimeZone, utcToWallClock, wallClockToUtc } from './time';
export { CALENDAR_UID_NAMESPACE, calendarUid } from './uid';
