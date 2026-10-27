import { describe, expect, it } from 'vitest';
import {
  caseCountry,
  caseCountryOptions,
  savedCaseMatchTerms,
  travellerMatchTerms,
} from './case-choices';

describe('case choices', () => {
  it('takes a country only from the picker list, by its code in any case', () => {
    expect(caseCountry(' gb ')).toEqual({ iso2: 'GB', name: 'United Kingdom' });
    expect(caseCountry('Atlantis')).toBeNull();
    expect(caseCountryOptions().some((country) => country.iso2 === 'GB')).toBe(true);
  });

  it("names the traveller's own countries by code, name and nationality word", () => {
    const terms = travellerMatchTerms({
      nationality: ['Bangladeshi'],
      residence: ['United Arab Emirates'],
    });
    expect(terms.nationality.known).toBe(true);
    expect(terms.nationality.terms).toEqual(
      expect.arrayContaining(['Bangladeshi', 'BD', 'Bangladesh']),
    );
    expect(terms.residence).toMatchObject({ known: true });
    expect(terms.residence.terms).toEqual(expect.arrayContaining(['AE', 'UAE']));
    expect(
      travellerMatchTerms({ nationality: ['india'], residence: [] }).nationality.terms,
    ).toContain('IN');
  });

  it('reads the three-letter codes a passport prints, for any country', () => {
    for (const [code, iso2] of [
      ['BGD', 'BD'],
      ['IND', 'IN'],
      ['GBR', 'GB'],
      ['pak', 'PK'],
    ] as const) {
      const read = travellerMatchTerms({ nationality: [code], residence: [] }).nationality;
      expect(read.known).toBe(true);
      expect(read.terms).toContain(iso2);
    }
  });

  it('counts a value that names no country as not known, and nothing confirmed as not known', () => {
    for (const word of ['Indian', 'British', 'Congo', 'XYZ']) {
      expect(travellerMatchTerms({ nationality: [word], residence: [] }).nationality).toEqual({
        terms: [],
        known: false,
      });
    }
    const mixed = travellerMatchTerms({ nationality: ['BGD', 'Indian'], residence: [] });
    expect(mixed.nationality.known).toBe(false);
    expect(mixed.nationality.terms).toContain('BD');
    expect(travellerMatchTerms({ nationality: [], residence: [] })).toEqual({
      nationality: { terms: [], known: false },
      residence: { terms: [], known: false },
    });
  });

  it("reads a saved case's country and purpose back as match terms", () => {
    const terms = savedCaseMatchTerms('United Kingdom', 'Tourism');
    expect(terms?.country).toEqual(expect.arrayContaining(['GB', 'UK']));
    expect(terms?.purpose).toEqual(expect.arrayContaining(['tourism', 'Tourism']));
    expect(savedCaseMatchTerms('Narnia', 'Gap year')).toEqual({
      country: ['Narnia'],
      purpose: ['Gap year'],
    });
    expect(savedCaseMatchTerms('Japan', null)).toBeNull();
    expect(savedCaseMatchTerms(' ', 'Tourism')).toBeNull();
  });
});
