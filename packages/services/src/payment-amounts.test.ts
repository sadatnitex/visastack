import { describe, expect, it } from 'vitest';
import { MAX_MINOR_UNITS } from './invoice-ledger';
import {
  currencyDecimals,
  formatAmountForCurrency,
  formatMinorUnits,
  parseAmountForCurrency,
  parseDecimalToMinorUnits,
} from './payment-amounts';

describe('payment amounts', () => {
  it('reads plain decimals exactly, with gateway padding', () => {
    const cases: Array<[string, number]> = [
      ['0', 0],
      ['0.01', 1],
      ['100', 10000],
      ['100.5', 10050],
      ['100.50', 10050],
      ['100.5000', 10050],
      ['1250.00', 125000],
      [' 10.00 ', 1000],
      ['21474836.47', MAX_MINOR_UNITS],
    ];
    for (const [text, minor] of cases) expect(parseDecimalToMinorUnits(text), text).toBe(minor);
  });

  it('refuses anything that is not a plain, non-negative decimal that fits', () => {
    for (const bad of [
      '',
      ' ',
      '.5',
      '5.',
      '-5',
      '+5',
      '1e3',
      '1E3',
      '0x10',
      '1,250.00',
      '1 250.00',
      '100.505',
      '100.5001',
      '21474836.48',
      '9999999999999.00',
      'NaN',
      'Infinity',
      '１２３',
    ]) {
      expect(parseDecimalToMinorUnits(bad), bad).toBeNull();
    }
  });

  it('is exact where floating point is not (0.1 + 0.2 style sums, large values)', () => {
    expect(parseDecimalToMinorUnits('0.29')).toBe(29);
    expect(parseDecimalToMinorUnits('1.15')).toBe(115);
    expect(parseDecimalToMinorUnits('4.35')).toBe(435);
    expect(parseDecimalToMinorUnits('20000000.07')).toBe(2000000007);
  });

  it('formats minor units as decimal text and round-trips', () => {
    expect(formatMinorUnits(0)).toBe('0.00');
    expect(formatMinorUnits(5)).toBe('0.05');
    expect(formatMinorUnits(125050)).toBe('1250.50');
    expect(formatMinorUnits(MAX_MINOR_UNITS)).toBe('21474836.47');
    for (const minor of [0, 1, 99, 100, 101, 12345, 999999, MAX_MINOR_UNITS]) {
      expect(parseDecimalToMinorUnits(formatMinorUnits(minor))).toBe(minor);
    }
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatMinorUnits(bad)).toThrow();
    }
  });

  it('knows how many places a currency has, and assumes two for an unknown code', () => {
    expect(currencyDecimals('BDT')).toBe(2);
    expect(currencyDecimals(' usd ')).toBe(2);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('BHD')).toBe(3);
    expect(currencyDecimals('not a code')).toBe(2);
  });

  it('reads a typed amount in the invoice currency exactly, and refuses extra places', () => {
    expect(parseAmountForCurrency('1250.50', 'BDT')).toBe(125050);
    expect(parseAmountForCurrency('1250', 'BDT')).toBe(125000);
    expect(parseAmountForCurrency('1250', 'JPY')).toBe(1250);
    expect(parseAmountForCurrency('1250.0', 'JPY')).toBe(1250);
    expect(parseAmountForCurrency('1250.5', 'JPY')).toBeNull();
    expect(parseAmountForCurrency('1.234', 'BHD')).toBe(1234);
    expect(parseAmountForCurrency('1.2345', 'BHD')).toBeNull();
    expect(parseAmountForCurrency('100.505', 'BDT')).toBeNull();
    for (const bad of ['', '-5', '1e3', '1,250', '.5', '5.', '99999999999999', '21474836.48']) {
      expect(parseAmountForCurrency(bad, 'BDT'), bad).toBeNull();
    }
  });

  it('writes an amount with the currency code and its own places', () => {
    expect(formatAmountForCurrency(125050, ' bdt ')).toBe('BDT\u00a01,250.50');
    expect(formatAmountForCurrency(1250, 'JPY')).toBe('JPY\u00a01,250');
    expect(formatAmountForCurrency(1234, 'BHD')).toBe('BHD\u00a01.234');
  });
});
