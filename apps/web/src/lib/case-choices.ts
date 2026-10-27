import { packMatchKey } from '@visastack/core';
import {
  CATALOGUE_PURPOSES,
  PURPOSE_FAMILY_KEYS,
  type PurposeFamilyKey,
} from '@visastack/core/catalogue';
import {
  COUNTRY_CODES,
  DESTINATIONS,
  SCHENGEN_ISO2,
  SCHENGEN_ROUTE_COUNTRY,
  alpha2ForAlpha3,
  destinationByIso2,
} from '@visastack/core/destinations';
import type {
  TravellerCountries,
  TravellerCoverage,
  TravellerMatchTerms,
} from '@visastack/services';
import { COUNTRY_ALIASES } from './country-start';

/**
 * The two pickers on the new-case form (owner list item 1): where the person is going, from the
 * countries the app holds facts for, and what the trip is for, from the owner-approved purpose
 * list. Server side: the page sends the browser only these short lists, and the action checks
 * every answer against the same lists, so a value the lists do not hold is never saved.
 */

export interface CaseCountryOption {
  readonly iso2: string;
  readonly name: string;
}

export interface CasePurposeOption {
  readonly key: string;
  readonly label: string;
}

export interface CasePurposeGroup {
  readonly family: PurposeFamilyKey;
  readonly label: string;
  readonly options: readonly CasePurposeOption[];
}

/** Plain group names for the purpose families, in the order the picker shows them. */
export const PURPOSE_FAMILY_LABELS: Readonly<Record<PurposeFamilyKey, string>> = {
  visit: 'Visit',
  study: 'Study',
  work: 'Work',
  settle: 'Join Family or Settle',
  protection: 'Protection and Official Travel',
  after_decision: 'After a Decision',
  supporting: 'Supporting Applications',
  beyond: 'Beyond Visas',
};

let countries: readonly CaseCountryOption[] | undefined;

/** Every country the app holds, by name. */
export function caseCountryOptions(): readonly CaseCountryOption[] {
  countries ??= [...DESTINATIONS]
    .map((destination) => ({ iso2: destination.iso2, name: destination.country }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return countries;
}

let purposes: readonly CasePurposeGroup[] | undefined;

/**
 * The purposes a person can choose, grouped by family. Routes the owner keeps for an adviser
 * alone (protection, investment) are left out: those cases are not started here.
 */
export function casePurposeGroups(): readonly CasePurposeGroup[] {
  purposes ??= PURPOSE_FAMILY_KEYS.map((family) => ({
    family,
    label: PURPOSE_FAMILY_LABELS[family],
    options: CATALOGUE_PURPOSES.filter(
      (purpose) => purpose.family === family && purpose.handling !== 'adviser_only',
    ).map((purpose) => ({ key: purpose.key, label: purpose.label })),
  })).filter((group) => group.options.length > 0);
  return purposes;
}

/** The country a submitted code names, or null when the list does not hold it. */
export function caseCountry(iso2: string): CaseCountryOption | null {
  const destination = destinationByIso2(iso2);
  return destination ? { iso2: destination.iso2, name: destination.country } : null;
}

/** The purpose a submitted key names, or null when the picker does not offer it. */
export function casePurpose(key: string): CasePurposeOption | null {
  const wanted = key.trim();
  for (const group of casePurposeGroups()) {
    const found = group.options.find((option) => option.key === wanted);
    if (found) return found;
  }
  return null;
}

/**
 * Every name a checklist may use for this country: its code, its name, the other names people
 * use for it, and for a Schengen state the shared Schengen area.
 */
export function countryMatchTerms(country: CaseCountryOption): readonly string[] {
  return [
    country.iso2,
    country.name,
    ...(COUNTRY_ALIASES[country.iso2] ?? []),
    ...(SCHENGEN_ISO2.includes(country.iso2)
      ? ['Schengen', 'Schengen Area', SCHENGEN_ROUTE_COUNTRY]
      : []),
  ];
}

/** Every name a checklist may use for this purpose: its key and its label. */
export function purposeMatchTerms(purpose: CasePurposeOption): readonly string[] {
  return [purpose.key, purpose.label];
}

/**
 * The one nationality word that names a country here. The app's reference data is written for
 * Bangladeshi travellers and the profile suggests typing "Bangladeshi", so that word is read as
 * Bangladesh. Any other such word ("Indian", "British") names no country here and counts as not
 * known, so a checklist meant only for some nationalities is never linked on its strength.
 */
const NATIONALITY_WORDS: Readonly<Record<string, readonly string[]>> = {
  BD: ['Bangladeshi'],
};

let countriesByName: ReadonlyMap<string, CaseCountryOption> | undefined;

/** Every ISO 3166 country, with its English name. */
function everyCountry(): readonly CaseCountryOption[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  return COUNTRY_CODES.flatMap(([iso2]) => {
    const name = names.of(iso2);
    return name ? [{ iso2, name }] : [];
  });
}

/**
 * The country a saved or typed name stands for (its two- or three-letter code, its name, another
 * common name or the known nationality word), or null. A case's own country comes from the
 * picker's list; a traveller's nationality may be any country, so every country is known here.
 */
function countryNamed(text: string): CaseCountryOption | null {
  if (!countriesByName) {
    const byName = new Map<string, CaseCountryOption>();
    const add = (name: string, country: CaseCountryOption) => {
      const key = packMatchKey(name);
      if (key.length > 0 && !byName.has(key)) byName.set(key, country);
    };
    for (const country of [...caseCountryOptions(), ...everyCountry()]) {
      for (const name of countryNames(country)) add(name, country);
    }
    countriesByName = byName;
  }
  const byName = countriesByName.get(packMatchKey(text));
  if (byName) return byName;
  // A passport reading saves the three-letter code (BGD).
  const iso2 = /^[A-Za-z]{3}$/.test(text.trim()) ? alpha2ForAlpha3(text) : undefined;
  return iso2 ? (countriesByName.get(packMatchKey(iso2)) ?? null) : null;
}

/** A country's code, name, other common names and nationality word. */
function countryNames(country: CaseCountryOption): readonly string[] {
  return [
    country.iso2,
    country.name,
    ...(COUNTRY_ALIASES[country.iso2] ?? []),
    ...(NATIONALITY_WORDS[country.iso2] ?? []),
  ];
}

/**
 * Every name a checklist may use for the traveller's own countries (nationalities or a
 * residence). A value that names no country adds no names and makes the whole answer not known:
 * the traveller may be covered by a checklist the app cannot tell apart.
 */
function travellerCountries(values: readonly string[]): TravellerCountries {
  const terms: string[] = [];
  let known = values.length > 0;
  for (const value of values) {
    const country = countryNamed(value);
    if (country) terms.push(value, ...countryNames(country));
    else known = false;
  }
  return { terms, known };
}

/** The traveller's confirmed values as checklist match terms; empty lists mean "not known". */
export function travellerMatchTerms(coverage: TravellerCoverage): TravellerMatchTerms {
  return {
    nationality: travellerCountries(coverage.nationality),
    residence: travellerCountries(coverage.residence),
  };
}

/**
 * The country and purpose a saved case names, as checklist match terms, or null when it names no
 * country or no purpose. A case started from the pickers saved the country's name and the
 * purpose's label; an older case may hold other words, which are matched as they are.
 */
export function savedCaseMatchTerms(
  destination: string | null,
  purpose: string | null,
): { readonly country: readonly string[]; readonly purpose: readonly string[] } | null {
  const place = destination?.trim() ?? '';
  const reason = purpose?.trim() ?? '';
  if (place.length === 0 || reason.length === 0) return null;
  const country = countryNamed(place);
  const wanted = packMatchKey(reason);
  const option = casePurposeGroups()
    .flatMap((group) => group.options)
    .find((item) => packMatchKey(item.label) === wanted || packMatchKey(item.key) === wanted);
  return {
    country: country ? countryMatchTerms(country) : [place],
    purpose: option ? purposeMatchTerms(option) : [reason],
  };
}
