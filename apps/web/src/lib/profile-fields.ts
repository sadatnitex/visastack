/**
 * The curated launch set of canonical Master Profile fields. Every manual edit
 * references a key that exists in this registry — fields cannot be invented
 * (Build Spec §4.1). Registered idempotently on first edit.
 */
export interface ProfileFieldDef {
  readonly key: string;
  readonly label: string;
  readonly sensitivity: 'STANDARD' | 'SENSITIVE' | 'RESTRICTED';
  /** Optional input hint for the editor. */
  readonly type?: 'text' | 'date';
  readonly placeholder?: string;
}

export const PROFILE_FIELDS: readonly ProfileFieldDef[] = [
  {
    key: 'given_name',
    label: 'Given name',
    sensitivity: 'STANDARD',
    placeholder: 'As on passport',
  },
  {
    key: 'family_name',
    label: 'Family name',
    sensitivity: 'STANDARD',
    placeholder: 'As on passport',
  },
  { key: 'date_of_birth', label: 'Date of birth', sensitivity: 'SENSITIVE', type: 'date' },
  {
    key: 'nationality',
    label: 'Nationality',
    sensitivity: 'STANDARD',
    placeholder: 'e.g. Bangladeshi',
  },
  { key: 'sex', label: 'Sex', sensitivity: 'STANDARD', placeholder: 'M / F / X' },
  { key: 'passport_number', label: 'Passport number', sensitivity: 'SENSITIVE' },
  { key: 'passport_expiry', label: 'Passport expiry', sensitivity: 'STANDARD', type: 'date' },
  { key: 'place_of_birth', label: 'Place of birth', sensitivity: 'STANDARD' },
] as const;

const BY_KEY = new Map(PROFILE_FIELDS.map((f) => [f.key, f]));

export function profileField(key: string): ProfileFieldDef | undefined {
  return BY_KEY.get(key);
}
