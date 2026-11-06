import { describe, expect, it } from 'vitest';
import { countryStartData, officialPageForDestination } from './country-start';

describe('the official page for a place a case travels to', () => {
  it('matches the whole name, a code or a name people type, in any letter case', () => {
    const japan = officialPageForDestination('Japan');
    expect(japan).toMatch(/^https:\/\//);
    expect(officialPageForDestination('  japan ')).toBe(japan);
    expect(officialPageForDestination('JP')).toBe(japan);
    const uk = officialPageForDestination('UK');
    expect(uk).toBe(officialPageForDestination('United Kingdom'));
  });

  it('never matches part of a word, and gives nothing for an empty or unknown place', () => {
    expect(officialPageForDestination('Jap')).toBeNull();
    expect(officialPageForDestination('Nowhere Land')).toBeNull();
    expect(officialPageForDestination('')).toBeNull();
    expect(officialPageForDestination(null)).toBeNull();
    expect(officialPageForDestination(undefined)).toBeNull();
  });

  it('only ever returns a secure address that the data holds', () => {
    const held = new Set(countryStartData().countries.map((c) => c.officialUrl));
    for (const country of countryStartData().countries) {
      const found = officialPageForDestination(country.name);
      if (found !== null) {
        expect(found.startsWith('https://')).toBe(true);
        expect(held.has(found)).toBe(true);
      }
    }
  });
});
