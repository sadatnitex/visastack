import { describe, expect, it } from 'vitest';
import {
  COMMON_TIME_ZONES,
  describeTimeZone,
  formatOffset,
  groupTimeZones,
  listTimeZones,
  offsetMinutesAt,
} from './time-zones';

const SUMMER = new Date('2026-07-01T12:00:00Z');
const WINTER = new Date('2026-01-15T12:00:00Z');

describe('time zone offsets', () => {
  it('reads the offset in minutes, east positive', () => {
    expect(offsetMinutesAt('Asia/Dhaka', SUMMER)).toBe(360);
    expect(offsetMinutesAt('Asia/Kolkata', SUMMER)).toBe(330);
    expect(offsetMinutesAt('Asia/Kathmandu', SUMMER)).toBe(345);
    expect(offsetMinutesAt('America/New_York', WINTER)).toBe(-300);
    expect(offsetMinutesAt('UTC', SUMMER)).toBe(0);
  });

  it('follows daylight saving: the same zone has a different offset in summer', () => {
    expect(offsetMinutesAt('Europe/London', SUMMER)).toBe(60);
    expect(offsetMinutesAt('Europe/London', WINTER)).toBe(0);
  });

  it('gives null for a name the runtime does not know', () => {
    expect(offsetMinutesAt('Mars/Olympus', SUMMER)).toBeNull();
    expect(describeTimeZone('Mars/Olympus', SUMMER)).toBeNull();
  });

  it('writes the offset the way people read it', () => {
    expect(formatOffset(360)).toBe('UTC+06:00');
    expect(formatOffset(-210)).toBe('UTC-03:30');
    expect(formatOffset(0)).toBe('UTC+00:00');
  });
});

describe('time zone labels', () => {
  it('shows the offset and a readable city, and keeps the IANA name as the value', () => {
    const dhaka = describeTimeZone('Asia/Dhaka', SUMMER);
    expect(dhaka?.id).toBe('Asia/Dhaka');
    expect(dhaka?.label).toBe('(UTC+06:00) Dhaka');
    expect(describeTimeZone('America/Argentina/Buenos_Aires', SUMMER)?.label).toBe(
      '(UTC-03:00) Buenos Aires',
    );
  });
});

describe('the grouped list', () => {
  const all = listTimeZones(SUMMER);

  it('lists a full set of zones, each once, including the ones this product needs', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(new Set(all.map((option) => option.id)).size).toBe(all.length);
    for (const id of ['Asia/Dhaka', 'Asia/Singapore', 'UTC']) {
      expect(all.some((option) => option.id === id)).toBe(true);
    }
  });

  it('puts the device zone first in Common, then the usual places', () => {
    const grouped = groupTimeZones(all, 'Asia/Tokyo');
    expect(grouped.common[0]?.id).toBe('Asia/Tokyo');
    expect(grouped.common.map((option) => option.id)).toContain('Asia/Dhaka');
    expect(grouped.common.length).toBeLessThanOrEqual(COMMON_TIME_ZONES.length + 1);
  });

  it('shows every zone exactly once across Common and the regions', () => {
    const grouped = groupTimeZones(all, 'Asia/Dhaka');
    const ids = [
      ...grouped.common.map((option) => option.id),
      ...grouped.groups.flatMap((group) => group.options.map((option) => option.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(all.length);
  });

  it('orders each region by offset, then by city', () => {
    const grouped = groupTimeZones(all, null);
    for (const group of grouped.groups) {
      const offsets = group.options.map((option) => option.offsetMinutes);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    }
    expect(grouped.groups.map((group) => group.region)).toEqual(
      [...grouped.groups.map((group) => group.region)].sort((a, b) => a.localeCompare(b, 'en')),
    );
  });

  it('keeps a device zone that is not a usual place', () => {
    const grouped = groupTimeZones(all, 'Asia/Kathmandu');
    expect(grouped.common[0]?.id).toBe('Asia/Kathmandu');
  });
});
