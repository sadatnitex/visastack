import { CALENDAR_KIND_IDS, type CalendarKind, isCalendarKind } from './kinds';

/**
 * The one set of choices a person can make about their calendar dates. Today they come from the
 * calendar page's form for one download; the same object is what a stored per-person preference
 * or a live feed would keep, so every destination reads choices the same way.
 *
 * `version` lets stored choices be migrated: a later version adds a case to
 * `parseCalendarExportOptions` that turns the older shape into the newer one. A version this code
 * does not know (from newer code) falls back to the defaults rather than guess.
 */
export const CALENDAR_OPTIONS_VERSION = 1;

export const CALENDAR_TITLE_STYLES = ['generic', 'withCaseNames'] as const;
export type CalendarTitleStyle = (typeof CALENDAR_TITLE_STYLES)[number];

/** Reminder offsets a person may choose, in minutes before the date: at the time, 15 minutes, 1 hour, 1 day, 1 week. */
export const CALENDAR_ALARM_OFFSETS = [0, 15, 60, 1440, 10080] as const;
export type CalendarAlarmOffset = (typeof CALENDAR_ALARM_OFFSETS)[number];
/** At most this many reminders per event. */
export const CALENDAR_MAX_ALARMS = 3;

export interface CalendarExportOptions {
  readonly version: typeof CALENDAR_OPTIONS_VERSION;
  /** `generic` titles only, or the generic title plus " - <case name>". */
  readonly titleStyle: CalendarTitleStyle;
  /** Which kinds of date to include. */
  readonly kinds: readonly CalendarKind[];
  /** Reminders on every event, earliest first. */
  readonly alarms: readonly CalendarAlarmOffset[];
}

export const DEFAULT_CALENDAR_EXPORT_OPTIONS: CalendarExportOptions = Object.freeze({
  version: CALENDAR_OPTIONS_VERSION,
  titleStyle: 'generic',
  kinds: CALENDAR_KIND_IDS,
  alarms: Object.freeze([]) as readonly CalendarAlarmOffset[],
});

/** The form and query field names for each choice, so a page and a route never disagree. */
export const CALENDAR_OPTION_FIELDS = {
  version: 'v',
  titleStyle: 'titles',
  kinds: 'kind',
  alarms: 'remind',
} as const;

/** Form data or URL search parameters, a Next.js search-params record, or stored choices. */
export type CalendarOptionsInput =
  | { readonly getAll: (name: string) => readonly unknown[] }
  | Readonly<Record<string, unknown>>
  | null
  | undefined;

const MAX_VALUES = 20;

function valuesOf(input: CalendarOptionsInput, name: string): string[] {
  if (!input || typeof input !== 'object') return [];
  const raw: unknown =
    'getAll' in input && typeof input.getAll === 'function'
      ? input.getAll(name)
      : (input as Readonly<Record<string, unknown>>)[name];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list
    .slice(0, MAX_VALUES)
    .filter((value): value is string => typeof value === 'string' && value.length <= 32);
}

function isAlarmOffset(value: number): value is CalendarAlarmOffset {
  return (CALENDAR_ALARM_OFFSETS as readonly number[]).includes(value);
}

/** Choices as a stored preference would keep them; every field is untrusted until parsed. */
interface StoredCalendarOptions {
  readonly version?: unknown;
  readonly titleStyle?: unknown;
  readonly kinds?: unknown;
  readonly alarms?: unknown;
}

/** Stored choices (`{ version, titleStyle, kinds, alarms }`) rather than form fields. */
function isStoredShape(input: CalendarOptionsInput): input is Readonly<Record<string, unknown>> {
  return (
    !!input &&
    typeof input === 'object' &&
    !('getAll' in input) &&
    'version' in input &&
    typeof (input as { version?: unknown }).version === 'number'
  );
}

/**
 * Turns untrusted input into valid options. Never throws: anything missing, unknown, repeated or
 * out of range falls back to the default for that choice. An empty or unknown kinds list means
 * all kinds, so a bad value never silently empties a file.
 */
export function parseCalendarExportOptions(input: CalendarOptionsInput): CalendarExportOptions {
  let version: unknown;
  let titleStyle: unknown;
  let kinds: unknown[];
  let alarms: unknown[];
  if (isStoredShape(input)) {
    const stored = input as StoredCalendarOptions;
    version = stored.version;
    titleStyle = stored.titleStyle;
    kinds = Array.isArray(stored.kinds) ? stored.kinds.slice(0, MAX_VALUES) : [];
    alarms = Array.isArray(stored.alarms) ? stored.alarms.slice(0, MAX_VALUES) : [];
  } else {
    const [versionField] = valuesOf(input, CALENDAR_OPTION_FIELDS.version);
    version = versionField === undefined ? CALENDAR_OPTIONS_VERSION : Number(versionField);
    [titleStyle] = valuesOf(input, CALENDAR_OPTION_FIELDS.titleStyle);
    kinds = valuesOf(input, CALENDAR_OPTION_FIELDS.kinds);
    alarms = valuesOf(input, CALENDAR_OPTION_FIELDS.alarms).map((value) =>
      /^\d{1,5}$/.test(value) ? Number(value) : Number.NaN,
    );
  }
  if (version !== CALENDAR_OPTIONS_VERSION) return DEFAULT_CALENDAR_EXPORT_OPTIONS;

  const chosenKinds = CALENDAR_KIND_IDS.filter((kind) => kinds.some((value) => value === kind));
  const chosenAlarms = [
    ...new Set(
      alarms.filter(
        (value): value is CalendarAlarmOffset => typeof value === 'number' && isAlarmOffset(value),
      ),
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, CALENDAR_MAX_ALARMS);
  return Object.freeze({
    version: CALENDAR_OPTIONS_VERSION,
    titleStyle: CALENDAR_TITLE_STYLES.find((style) => style === titleStyle) ?? 'generic',
    kinds: chosenKinds.length > 0 && kinds.every(isCalendarKind) ? chosenKinds : CALENDAR_KIND_IDS,
    alarms: chosenAlarms,
  });
}

/**
 * The options as form fields (name, value), the inverse of `parseCalendarExportOptions`, so a
 * preview can carry the same choices to the download. Defaults are left out.
 */
export function calendarOptionFields(
  options: CalendarExportOptions,
): readonly (readonly [string, string])[] {
  const fields: (readonly [string, string])[] = [];
  if (options.titleStyle !== 'generic') {
    fields.push([CALENDAR_OPTION_FIELDS.titleStyle, options.titleStyle]);
  }
  if (options.kinds.length !== CALENDAR_KIND_IDS.length) {
    for (const kind of options.kinds) fields.push([CALENDAR_OPTION_FIELDS.kinds, kind]);
  }
  for (const alarm of options.alarms) fields.push([CALENDAR_OPTION_FIELDS.alarms, String(alarm)]);
  return fields;
}
