import { describe, expect, it } from 'vitest';
import { dayCount } from './day-count';

describe('a number of days with its unit', () => {
  it('says "day" for one and "days" otherwise', () => {
    expect(dayCount(1)).toBe('1 day');
    expect(dayCount(0)).toBe('0 days');
    expect(dayCount(14)).toBe('14 days');
  });
});
