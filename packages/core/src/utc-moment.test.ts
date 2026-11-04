import { describe, expect, it } from 'vitest';
import { formatUtcMoment } from './utc-moment';

describe('a moment in one fixed zone', () => {
  it('pads the time, spells the month in three letters and always says UTC', () => {
    expect(formatUtcMoment(new Date('2026-11-04T09:05:00Z'))).toBe('4 Nov 2026 at 09:05 UTC');
    expect(formatUtcMoment(new Date('2027-01-31T23:59:00Z'))).toBe('31 Jan 2027 at 23:59 UTC');
    expect(formatUtcMoment(new Date('2026-09-03T00:00:00Z'))).toBe('3 Sep 2026 at 00:00 UTC');
  });
});
