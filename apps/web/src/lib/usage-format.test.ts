import { describe, expect, it } from 'vitest';
import { formatPrice } from './usage-format';

describe('formatPrice (visa fees on the rules pages)', () => {
  it('keeps the currency symbol where the platform has one', () => {
    expect(formatPrice(10000, 'USD')).toBe('$100.00');
    expect(formatPrice(1250, 'JPY')).toBe('¥1,250');
  });

  it('never throws on a bad currency code (S30, audit M6)', () => {
    for (const code of ['XYZ', '', 'not a code', 'BD']) {
      expect(() => formatPrice(250000, code)).not.toThrow();
    }
    expect(formatPrice(250000, 'XYZ')).toBe('2,500.00 XYZ');
  });
});
