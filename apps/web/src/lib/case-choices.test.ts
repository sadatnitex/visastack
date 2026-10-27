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
    expect(terms.nationality).toEqual(expect.arrayContaining(['Bangladeshi', 'BD', 'Bangladesh']));
    expect(terms.residence).toEqual(expect.arrayContaining(['AE', 'UAE']));
    // A passport reading saves the three-letter code; a country name works too.
    expect(travellerMatchTerms({ nationality: ['BGD'], residence: [] }).nationality).toContain(
      'BD',
    );
    expect(travellerMatchTerms({ nationality: ['india'], residence: [] }).nationality).toContain(
      'IN',
    );
  });

  it('keeps a word that names no country as it is, and an unknown traveller unknown', () => {
    expect(travellerMatchTerms({ nationality: ['Congo'], residence: [] })).toEqual({
      nationality: ['Congo'],
      residence: [],
    });
    expect(travellerMatchTerms({ nationality: [], residence: [] })).toEqual({
      nationality: [],
      residence: [],
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
