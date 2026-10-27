import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES, DESTINATIONS, alpha2ForAlpha3 } from './index';

describe('country codes', () => {
  it('holds every ISO 3166-1 country once, with well-formed codes', () => {
    expect(COUNTRY_CODES.length).toBeGreaterThanOrEqual(249);
    expect(new Set(COUNTRY_CODES.map(([alpha2]) => alpha2)).size).toBe(COUNTRY_CODES.length);
    expect(new Set(COUNTRY_CODES.map(([, alpha3]) => alpha3)).size).toBe(COUNTRY_CODES.length);
    for (const [alpha2, alpha3] of COUNTRY_CODES) {
      expect(alpha2).toMatch(/^[A-Z]{2}$/);
      expect(alpha3).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('covers every destination the app holds', () => {
    const known = new Set(COUNTRY_CODES.map(([alpha2]) => alpha2));
    expect(DESTINATIONS.filter((destination) => !known.has(destination.iso2))).toEqual([]);
  });

  it('turns a passport code into the two-letter code', () => {
    expect(alpha2ForAlpha3('BGD')).toBe('BD');
    expect(alpha2ForAlpha3(' gbr ')).toBe('GB');
    expect(alpha2ForAlpha3('IND')).toBe('IN');
    expect(alpha2ForAlpha3('XYZ')).toBeUndefined();
  });
});
