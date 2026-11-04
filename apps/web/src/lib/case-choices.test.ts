import { describe, expect, it } from 'vitest';
import {
  caseCountriesForFamily,
  caseCountry,
  caseCountryOptions,
  casePurposeGroups,
  resolveCaseCountry,
  savedCaseMatchTerms,
  travellerMatchTerms,
} from './case-choices';
import { COUNTRY_ALIASES } from './country-start';

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

  it("finds the countries of a person's own cases for one purpose family", () => {
    const study = casePurposeGroups().find((group) => group.family === 'study')?.options[0];
    const visit = casePurposeGroups().find((group) => group.family === 'visit')?.options[0];
    if (!study || !visit) throw new Error('missing purposes');
    const cases = [
      { destination: 'Ireland', purpose: study.label },
      { destination: 'United States', purpose: visit.label },
      { destination: 'Narnia', purpose: study.label },
      { destination: null, purpose: study.label },
      { destination: 'Australia', purpose: 'Gap year' },
    ];
    expect([...caseCountriesForFamily(cases, 'study')]).toEqual(['IE']);
    expect([...caseCountriesForFamily(cases, 'visit')]).toEqual(['US']);
    expect(caseCountriesForFamily([], 'study').size).toBe(0);
  });
});

describe('the destination box: a typed answer becomes one validated country or nothing', () => {
  it('turns every country in the list, by its whole name, into that country and no other', () => {
    for (const country of caseCountryOptions()) {
      const wanted = { iso2: country.iso2, name: country.name };
      expect(resolveCaseCountry(country.name), country.name).toEqual(wanted);
      expect(resolveCaseCountry(country.name.toUpperCase()), country.name).toEqual(wanted);
      expect(resolveCaseCountry(`  ${country.name.toLowerCase()}  `), country.name).toEqual(wanted);
      expect(resolveCaseCountry(country.iso2), country.iso2).toEqual(wanted);
    }
  });

  it('reads the other names people use, each for exactly one country', () => {
    const claimed = new Map<string, string>();
    for (const [iso2, names] of Object.entries(COUNTRY_ALIASES)) {
      for (const name of names) {
        expect(resolveCaseCountry(name)?.iso2, name).toBe(iso2);
        const key = name.toLowerCase();
        expect(claimed.get(key), `${name} is claimed twice`).toBeUndefined();
        claimed.set(key, iso2);
      }
    }
    expect(resolveCaseCountry('uk')?.iso2).toBe('GB');
    expect(resolveCaseCountry('Holland')?.name).toBe('Netherlands');
  });

  it('does not mind accents, hyphens, apostrophes or extra spaces', () => {
    expect(resolveCaseCountry("Cote d'Ivoire")?.iso2).toBe('CI');
    expect(resolveCaseCountry('Côte d’Ivoire')?.iso2).toBe('CI');
    expect(resolveCaseCountry('timor leste')?.iso2).toBe('TL');
    expect(resolveCaseCountry('United   Kingdom')?.iso2).toBe('GB');
  });

  it('refuses part of a name, a name two countries share, and anything else', () => {
    for (const text of [
      '',
      '   ',
      'Korea',
      'Congo',
      'United',
      'Unit',
      'Atlantis',
      'Japanese',
      'gb',
      'ZZ',
      'GBR',
      'Japan, please',
      'Not Sure Yet',
    ]) {
      expect(resolveCaseCountry(text), text).toBeNull();
    }
  });
});
