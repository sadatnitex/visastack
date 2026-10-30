import { describe, expect, it } from 'vitest';
import {
  currencyDecimals,
  formatMoney,
  formatMoneyNumber,
  isIsoCurrencyCode,
  looksLikeMoney,
  normalizeCurrencyCode,
  parseMoney,
} from './money';

describe('money (S30)', () => {
  it('knows real ISO 4217 codes and refuses look-alikes', () => {
    expect(isIsoCurrencyCode('BDT')).toBe(true);
    expect(isIsoCurrencyCode(' usd ')).toBe(true);
    expect(isIsoCurrencyCode('JPY')).toBe(true);
    for (const bad of ['XYZ', 'QQQ', 'BD', 'BDTT', '', '12A', 'B D']) {
      expect(isIsoCurrencyCode(bad), bad).toBe(false);
    }
    expect(normalizeCurrencyCode(' bdt ')).toBe('BDT');
  });

  it("uses each currency's own decimal places, and two for anything unknown", () => {
    expect(currencyDecimals('BDT')).toBe(2);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('BHD')).toBe(3);
    expect(currencyDecimals('not a code')).toBe(2);
  });

  it('formats with thousands separators and the code first', () => {
    expect(formatMoney(250000, 'BDT')).toBe('BDT\u00a02,500.00');
    expect(formatMoney(0, 'BDT')).toBe('BDT\u00a00.00');
    expect(formatMoney(5, 'BDT')).toBe('BDT\u00a00.05');
    expect(formatMoney(123456789, ' bdt ')).toBe('BDT\u00a01,234,567.89');
    expect(formatMoney(1250, 'JPY')).toBe('JPY\u00a01,250');
    expect(formatMoney(1234, 'BHD')).toBe('BHD\u00a01.234');
    expect(formatMoney(-50000, 'BDT')).toBe('BDT\u00a0-500.00');
  });

  it('never throws: an unknown code goes after the amount with two places', () => {
    expect(formatMoney(250000, 'XYZ')).toBe('2,500.00\u00a0XYZ');
    expect(formatMoney(250000, '')).toBe('2,500.00\u00a0unknown currency');
    expect(formatMoney(250000, 'not-a-currency-at-all')).toBe('2,500.00\u00a0unknown currency');
    expect(formatMoney(Number.NaN, 'BDT')).toBe('BDT\u00a00.00');
    expect(formatMoney(1.5, 'BDT')).toBe('BDT\u00a00.00');
  });

  it('gives the bare number, grouped or not', () => {
    expect(formatMoneyNumber(250000, 'BDT')).toBe('2,500.00');
    expect(formatMoneyNumber(250000, 'BDT', { grouping: false })).toBe('2500.00');
    expect(formatMoneyNumber(100, 'JPY', { grouping: false })).toBe('100');
  });

  it('reads typed amounts exactly, with or without separators', () => {
    expect(parseMoney('2,500.00', 'BDT')).toBe(250000);
    expect(parseMoney('2500', 'BDT')).toBe(250000);
    expect(parseMoney(' 2,500 ', 'BDT')).toBe(250000);
    expect(parseMoney('1,234,567.89', 'BDT')).toBe(123456789);
    expect(parseMoney('0.1', 'BDT')).toBe(10);
    expect(parseMoney('1250', 'JPY')).toBe(1250);
    expect(parseMoney('1250.0', 'JPY')).toBe(1250);
    expect(parseMoney('1.234', 'BHD')).toBe(1234);
    expect(parseMoney('100.500', 'BDT')).toBe(10050);
  });

  it('refuses anything that is not a plain amount in that currency', () => {
    for (const bad of [
      '',
      '-5',
      '+5',
      '1e3',
      '.5',
      '5.',
      '25,00',
      '2,50,000',
      '1,2345',
      'BDT 5',
      '5 BDT',
      '100.505',
    ]) {
      expect(parseMoney(bad, 'BDT'), bad).toBeNull();
    }
    expect(parseMoney('1250.5', 'JPY')).toBeNull();
    expect(parseMoney('1.2345', 'BHD')).toBeNull();
    expect(parseMoney('21474836.48', 'BDT', 2_147_483_647)).toBeNull();
    expect(parseMoney('21474836.47', 'BDT', 2_147_483_647)).toBe(2_147_483_647);
    expect(parseMoney('9'.repeat(20), 'BDT')).toBeNull();
  });

  it('formats and reads back the same amount', () => {
    for (const [amount, currency] of [
      [250000, 'BDT'],
      [1, 'BDT'],
      [987654321, 'USD'],
      [1250, 'JPY'],
      [1234, 'BHD'],
    ] as const) {
      expect(parseMoney(formatMoneyNumber(amount, currency), currency)).toBe(amount);
    }
  });

  it('checks the shape of a typed amount before any currency is known (S30)', () => {
    for (const good of ['2,500.00', '2500', '1.234', '0.5'])
      expect(looksLikeMoney(good), good).toBe(true);
    for (const bad of ['', '0', '0.000', 'abc', '-5', '1.2345', '12,50', '1e3']) {
      expect(looksLikeMoney(bad), bad).toBe(false);
    }
  });
});
