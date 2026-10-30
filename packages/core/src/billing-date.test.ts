import { describe, expect, it } from 'vitest';
import { billingDaysUntil, formatBillingDate, formatBillingDateTime } from './billing-date';

describe('billing dates (S30)', () => {
  it('writes day, short month and year on the Bangladesh calendar', () => {
    expect(formatBillingDate(new Date('2026-11-08T00:00:00Z'))).toBe('8 Nov 2026');
    expect(formatBillingDate('2026-11-08')).toBe('8 Nov 2026');
    // 20:00 UTC on 8 Nov is already 9 Nov in Dhaka.
    expect(formatBillingDate(new Date('2026-11-08T20:00:00Z'))).toBe('9 Nov 2026');
    expect(formatBillingDate(new Date('2026-09-01T00:00:00Z'))).toBe('1 Sep 2026');
  });

  it('can be read in another zone, and an unknown zone falls back to UTC', () => {
    expect(formatBillingDate(new Date('2026-11-08T20:00:00Z'), 'UTC')).toBe('8 Nov 2026');
    expect(formatBillingDate(new Date('2026-11-08T20:00:00Z'), 'Not/AZone')).toBe('8 Nov 2026');
  });

  it('adds the Bangladesh time on a 24-hour clock', () => {
    expect(formatBillingDateTime(new Date('2026-10-30T08:05:00Z'))).toBe('30 Oct 2026, 14:05');
    expect(formatBillingDateTime(new Date('2026-10-30T18:00:00Z'))).toBe('31 Oct 2026, 00:00');
  });

  it('gives an empty text for an unreadable value', () => {
    expect(formatBillingDate('not a date')).toBe('');
    expect(formatBillingDateTime(new Date(Number.NaN))).toBe('');
  });

  it('counts Bangladesh days to a due date', () => {
    const now = new Date('2026-10-30T10:00:00Z');
    expect(billingDaysUntil(new Date('2026-10-30T00:00:00Z'), now)).toBe(0);
    expect(billingDaysUntil(new Date('2026-11-08T00:00:00Z'), now)).toBe(9);
    expect(billingDaysUntil(new Date('2026-10-22T00:00:00Z'), now)).toBe(-8);
    // 19:00 UTC on 30 Oct is 31 Oct in Dhaka, so a due date of 30 Oct has passed by one day.
    expect(
      billingDaysUntil(new Date('2026-10-30T00:00:00Z'), new Date('2026-10-30T19:00:00Z')),
    ).toBe(-1);
  });
});
