import { describe, expect, it } from 'vitest';
import { CURRENT_TIME_ZONE_NAMES, currentTimeZoneName } from './zone-names';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The UTC offset (minutes) of `timeZone` at `instant`, read from the runtime. */
function offsetAt(timeZone: string, instant: number): number {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

describe('latest official time zone names (owner rule, 26 Oct 2026)', () => {
  it('always gives the current name, whatever was typed', () => {
    expect(currentTimeZoneName('Asia/Dhaka')).toBe('Asia/Dhaka');
    expect(currentTimeZoneName('asia/dhaka')).toBe('Asia/Dhaka');
    expect(currentTimeZoneName('Asia/Dacca')).toBe('Asia/Dhaka');
    expect(currentTimeZoneName('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(currentTimeZoneName('asia/calcutta')).toBe('Asia/Kolkata');
    expect(currentTimeZoneName('Europe/Kiev')).toBe('Europe/Kyiv');
    expect(currentTimeZoneName('Europe/Kyiv')).toBe('Europe/Kyiv');
    expect(currentTimeZoneName('Asia/Katmandu')).toBe('Asia/Kathmandu');
    expect(currentTimeZoneName('Asia/Saigon')).toBe('Asia/Ho_Chi_Minh');
    expect(currentTimeZoneName('America/Godthab')).toBe('America/Nuuk');
    expect(currentTimeZoneName('US/Eastern')).toBe('America/New_York');
    expect(currentTimeZoneName('America/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(currentTimeZoneName('America/Argentina/Buenos_Aires')).toBe(
      'America/Argentina/Buenos_Aires',
    );
    expect(currentTimeZoneName('UTC')).toBe('UTC');
    expect(currentTimeZoneName('Mars/Olympus_Mons')).toBeNull();
  });

  it('maps every old name to a current one the runtime knows, with the same clock rules', () => {
    const start = Date.UTC(2026, 0, 1);
    for (const [old, current] of Object.entries(CURRENT_TIME_ZONE_NAMES)) {
      expect(currentTimeZoneName(current), current).toBe(current);
      expect(CURRENT_TIME_ZONE_NAMES[current], `${current} is itself renamed`).toBeUndefined();
      // Same offsets through 2026, every 6 hours, so the rename never moves a time.
      for (let hour = 0; hour < 365 * 24; hour += 6) {
        const instant = start + hour * 3_600_000;
        if (offsetAt(old, instant) !== offsetAt(current, instant)) {
          throw new Error(`${old} and ${current} differ at ${new Date(instant).toISOString()}`);
        }
      }
    }
  }, 60_000);
});
