import { PROFILE_FIELDS, type ProfileFieldDef } from './profile-fields';

export const PROFILE_SECTIONS = [
  { key: 'personal', label: 'Personal details' },
  { key: 'identity', label: 'Passports & IDs' },
  { key: 'travel', label: 'Travel history' },
  { key: 'employment', label: 'Employment' },
  { key: 'finances', label: 'Finances' },
  { key: 'additional', label: 'Additional information' },
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number]['key'];

/** Presentation only. Canonical keys, repeating records and pack permissions do not change. */
export function profileSectionForField(field: ProfileFieldDef): ProfileSection {
  if (field.pack === 'professional') return 'employment';
  if (field.pack !== 'universal') return 'additional';
  if (field.key.startsWith('passport_') || field.group === 'historical_passport') return 'identity';
  if (['prior_visa', 'travel_history', 'visa_refusal'].includes(field.group ?? '')) return 'travel';
  if (
    ['annual_income', 'annual_income_currency', 'funding_source'].includes(field.key) ||
    field.group === 'sponsor'
  )
    return 'finances';
  return 'personal';
}
export function fieldsInProfileSection(section: ProfileSection): readonly ProfileFieldDef[] {
  return PROFILE_FIELDS.filter((field) => profileSectionForField(field) === section);
}
