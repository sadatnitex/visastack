import {
  CATALOGUE_PURPOSES,
  PURPOSE_FAMILY_KEYS,
  type PurposeFamilyKey,
} from '@visastack/core/catalogue';
import { DESTINATIONS, SCHENGEN_ISO2, SCHENGEN_ROUTE_COUNTRY } from '@visastack/core/destinations';
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
  const code = iso2.trim().toUpperCase();
  return caseCountryOptions().find((country) => country.iso2 === code) ?? null;
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
