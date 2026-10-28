import { describe, expect, it } from 'vitest';
import { readCaseDates, readFormDate } from './form-dates';

describe('reading a date box', () => {
  it('reads a real calendar day at midnight UTC, and blank as not given', () => {
    expect(readFormDate('2026-12-01')).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    expect(readFormDate(' 2028-02-29 ')).toEqual(new Date('2028-02-29T00:00:00.000Z'));
    expect(readFormDate('')).toBeUndefined();
    expect(readFormDate('   ')).toBeUndefined();
    expect(readFormDate(null)).toBeUndefined();
  });

  it('refuses a day that does not exist instead of rolling it into the next month', () => {
    expect(readFormDate('2026-02-30')).toBe('invalid');
    expect(readFormDate('2027-02-29')).toBe('invalid');
    expect(readFormDate('2026-13-01')).toBe('invalid');
  });

  it('refuses anything that is not a whole date', () => {
    expect(readFormDate('next Tuesday')).toBe('invalid');
    expect(readFormDate('2026-12')).toBe('invalid');
    expect(readFormDate('12/01/2026')).toBe('invalid');
    expect(readFormDate('2026-12-01T10:00')).toBe('invalid');
    expect(readFormDate(new File(['x'], 'date.txt'))).toBe('invalid');
  });

  it('names each wrong box and a trip that ends before it starts', () => {
    const values: Record<string, string> = {
      travelStartDate: '2026-12-10',
      travelEndDate: '2026-12-01',
      targetDeadline: '2026-02-30',
    };
    const { dates, errors } = readCaseDates((name) => values[name] ?? null);
    expect(errors).toEqual({
      travelEndDate: 'The trip cannot end before it starts.',
      targetDeadline: 'Enter a full date: day, month and year.',
    });
    expect(dates.travelStartDate).toEqual(new Date('2026-12-10T00:00:00.000Z'));
  });
});
