/**
 * Wall-clock time in an IANA zone to UTC, with the platform's own time zone data (Intl), so a
 * daylight saving change is handled the way the zone's rules say. Pure: no clock, no locale.
 */

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The zone's offset from UTC, in minutes, at one instant (positive east of Greenwich). */
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/**
 * The runtime's canonical spelling of a zone name ("asia/dhaka" becomes "Asia/Dhaka"), or null
 * when the runtime does not know it.
 */
export function canonicalTimeZone(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** True when the runtime knows the zone by this name. */
export function isKnownTimeZone(timeZone: string): boolean {
  return canonicalTimeZone(timeZone) !== null;
}

const DAY_MS = 86_400_000;

/**
 * The UTC instant (ISO 8601, `Z`) of a wall-clock `YYYY-MM-DDTHH:MM[:SS]` in `timeZone`, or null
 * when the zone is unknown or the wall clock is not a real one (month 13, 30 February, 25:00).
 *
 * The rule, the same in every zone, east or west of UTC:
 * - the offsets in force a day before and a day after are the only candidates (no zone changes
 *   twice in two days); each that gives back the same wall clock is a real occurrence;
 * - a time that happens twice (clocks going back) is the earlier instant, the first occurrence;
 * - a time that never happens (clocks going forward) uses the offset in force before the change,
 *   so it lands just after the gap, as calendar apps do (02:30 becomes 03:30).
 */
export function wallClockToUtc(localDateTime: string, timeZone: string): string | null {
  const match = localDateTime.match(WALL_CLOCK);
  if (!match || !isKnownTimeZone(timeZone)) return null;
  const [, y, mo, d, h, mi, s] = match;
  const parts = [Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0)] as const;
  const wall = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const check = new Date(wall);
  if (
    Number.isNaN(wall) ||
    check.getUTCFullYear() !== parts[0] ||
    check.getUTCMonth() !== parts[1] - 1 ||
    check.getUTCDate() !== parts[2] ||
    check.getUTCHours() !== parts[3] ||
    check.getUTCMinutes() !== parts[4] ||
    check.getUTCSeconds() !== parts[5]
  ) {
    return null;
  }
  const before = offsetMinutes(wall - DAY_MS, timeZone);
  const after = offsetMinutes(wall + DAY_MS, timeZone);
  const occurrences = [...new Set([before, after])]
    .map((offset) => wall - offset * 60_000)
    .filter((instant) => instant + offsetMinutes(instant, timeZone) * 60_000 === wall);
  const chosen = occurrences.length > 0 ? Math.min(...occurrences) : wall - before * 60_000;
  return new Date(chosen).toISOString().replace('.000Z', 'Z');
}

/** The wall clock (`YYYY-MM-DD` and `HH:MM`) of a UTC instant in `timeZone`. */
export function utcToWallClock(
  utc: string,
  timeZone: string,
): { readonly date: string; readonly time: string } | null {
  const instant = Date.parse(utc);
  if (Number.isNaN(instant) || !isKnownTimeZone(timeZone)) return null;
  const local = new Date(instant + offsetMinutes(instant, timeZone) * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}
