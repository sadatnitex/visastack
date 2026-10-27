/**
 * Time zones for a dropdown: every zone the runtime knows, grouped by region, each labelled with
 * its current offset from UTC and a readable city name. The stored value is always the IANA name
 * ("Asia/Dhaka"), exactly what the appointment actions already expect, so nothing downstream changes.
 */

export interface TimeZoneOption {
  /** The IANA name, which is what gets stored ("Asia/Dhaka"). */
  readonly id: string;
  /** The readable name ("Dhaka", "Buenos Aires"). */
  readonly city: string;
  readonly region: string;
  readonly offsetMinutes: number;
  /** For example "(UTC+06:00) Dhaka". */
  readonly label: string;
}

export interface TimeZoneGroup {
  readonly region: string;
  readonly options: readonly TimeZoneOption[];
}

export interface TimeZoneGroups {
  readonly common: readonly TimeZoneOption[];
  readonly groups: readonly TimeZoneGroup[];
}

/** Shown first: where this product's people mostly are, then the other big hubs. */
export const COMMON_TIME_ZONES: readonly string[] = [
  'Asia/Dhaka',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Kuala_Lumpur',
  'Asia/Bangkok',
  'Asia/Karachi',
  'Asia/Riyadh',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

/** Used only when the runtime cannot list its zones. */
const FALLBACK_TIME_ZONES: readonly string[] = [
  ...COMMON_TIME_ZONES,
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Chicago',
  'America/Denver',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Colombo',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Kathmandu',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Europe/Berlin',
  'Europe/Istanbul',
  'Europe/Madrid',
  'Europe/Moscow',
  'Pacific/Auckland',
];

/**
 * Runtimes list some zones under their old names. People know the modern ones, and both are valid
 * zone names to every part of the product, so the list offers the modern spelling.
 */
const MODERN_NAMES: Readonly<Record<string, string>> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
};

/** The offset of a zone at an instant, in minutes east of UTC, or null when the zone is unknown. */
export function offsetMinutesAt(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(at);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    if (name === 'GMT') return 0;
    const match = name.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return null;
    const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
    return match[1] === '-' ? -minutes : minutes;
  } catch {
    return null;
  }
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const rest = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${rest}`;
}

function cityOf(id: string): string {
  const last = id.split('/').pop() ?? id;
  return last.replaceAll('_', ' ');
}

function regionOf(id: string): string {
  const first = id.split('/')[0] ?? 'Other';
  return id.includes('/') ? first : 'Other';
}

/** One option for a zone, or null when the runtime does not know it. */
export function describeTimeZone(id: string, at: Date): TimeZoneOption | null {
  const offsetMinutes = offsetMinutesAt(id, at);
  if (offsetMinutes === null) return null;
  const city = id === 'UTC' ? 'Coordinated Universal Time' : cityOf(id);
  return {
    id,
    city,
    region: regionOf(id),
    offsetMinutes,
    label: `(${formatOffset(offsetMinutes)}) ${city}`,
  };
}

/** Every zone the runtime knows (or a safe fallback list), described at the given instant. */
export function listTimeZones(at: Date): TimeZoneOption[] {
  let ids: readonly string[];
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    ids = supported && supported.length > 0 ? supported : FALLBACK_TIME_ZONES;
  } catch {
    ids = FALLBACK_TIME_ZONES;
  }
  const seen = new Set<string>();
  const options: TimeZoneOption[] = [];
  for (const listed of [...ids, ...COMMON_TIME_ZONES]) {
    const id = MODERN_NAMES[listed] ?? listed;
    if (seen.has(id)) continue;
    seen.add(id);
    const described = describeTimeZone(id, at);
    if (described) options.push(described);
  }
  return options;
}

/** The zone this device is set to, or null when it cannot tell. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function byOffsetThenCity(a: TimeZoneOption, b: TimeZoneOption): number {
  return a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city, 'en');
}

/**
 * The dropdown's shape: a "Common" group first (this device's zone, then the usual places), then
 * every other zone grouped by region and ordered by offset. A zone appears exactly once.
 */
export function groupTimeZones(
  options: readonly TimeZoneOption[],
  device: string | null,
): TimeZoneGroups {
  const byId = new Map(options.map((option) => [option.id, option]));
  const commonIds = [...(device ? [device] : []), ...COMMON_TIME_ZONES];
  const common: TimeZoneOption[] = [];
  const used = new Set<string>();
  for (const id of commonIds) {
    const option = byId.get(id);
    if (option && !used.has(id)) {
      used.add(id);
      common.push(option);
    }
  }
  const regions = new Map<string, TimeZoneOption[]>();
  for (const option of options) {
    if (used.has(option.id)) continue;
    const list = regions.get(option.region) ?? [];
    list.push(option);
    regions.set(option.region, list);
  }
  const groups = [...regions.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([region, list]) => ({ region, options: [...list].sort(byOffsetThenCity) }));
  return { common, groups };
}
