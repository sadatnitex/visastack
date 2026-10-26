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

/** True when the runtime knows the zone by this name. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The UTC instant (ISO 8601, `Z`) of a wall-clock `YYYY-MM-DDTHH:MM[:SS]` in `timeZone`, or null
 * when either is not valid. A time that happens twice (clocks going back) is the first one; a time
 * that never happens (clocks going forward) moves forward by the size of the gap, as calendar apps
 * do.
 */
export function wallClockToUtc(localDateTime: string, timeZone: string): string | null {
  const match = WALL_CLOCK.exec(localDateTime);
  if (!match || !isKnownTimeZone(timeZone)) return null;
  const [, y, mo, d, h, mi, s] = match;
  const wall = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );
  if (Number.isNaN(wall)) return null;
  // Two passes: the offset at a first guess, then the offset at the corrected instant.
  const first = wall - offsetMinutes(wall, timeZone) * 60_000;
  const second = wall - offsetMinutes(first, timeZone) * 60_000;
  // Clocks going back: both offsets give a real instant for this wall clock; take the earlier.
  const candidates = [first, second].filter(
    (instant) => instant + offsetMinutes(instant, timeZone) * 60_000 === wall,
  );
  const chosen = candidates.length > 0 ? Math.min(...candidates) : Math.max(first, second);
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
