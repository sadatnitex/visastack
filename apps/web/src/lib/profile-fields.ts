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
  /**
   * Fields sharing a `group` render together as one repeatable record (Build
   * Spec §4.1: "supports single and repeating records"), e.g. multiple prior
   * visas. Each instance is tracked by an independent `repeatingRecordKey`.
   * Absent for single (non-repeating) fields.
   */
  readonly group?: string;
  readonly groupLabel?: string;
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
  // A repeating record — proves out the mechanism (Build Spec §4.1); the full
  // universal + target-group registry (addresses, employment, business,
  // finances, travel history, refusals, hosts/sponsors, dependants,
  // medical-travel data) is Release F (Profile PR) scope, not invented here.
  {
    key: 'prior_visa_country',
    label: 'Issuing country',
    sensitivity: 'STANDARD',
    placeholder: 'e.g. United States',
    group: 'prior_visa',
    groupLabel: 'Prior visa',
  },
  {
    key: 'prior_visa_type',
    label: 'Visa type',
    sensitivity: 'STANDARD',
    placeholder: 'e.g. B1/B2 tourist',
    group: 'prior_visa',
    groupLabel: 'Prior visa',
  },
  {
    key: 'prior_visa_number',
    label: 'Visa number',
    sensitivity: 'SENSITIVE',
    group: 'prior_visa',
    groupLabel: 'Prior visa',
  },
  {
    key: 'prior_visa_validity',
    label: 'Valid from / to',
    sensitivity: 'STANDARD',
    placeholder: 'e.g. 2022-01 to 2032-01',
    group: 'prior_visa',
    groupLabel: 'Prior visa',
  },
] as const;

const BY_KEY = new Map(PROFILE_FIELDS.map((f) => [f.key, f]));

export function profileField(key: string): ProfileFieldDef | undefined {
  return BY_KEY.get(key);
}

/** Non-repeating fields, in registry order. */
export function singleFields(): readonly ProfileFieldDef[] {
  return PROFILE_FIELDS.filter((f) => !f.group);
}

/** Repeating fields grouped by their `group` key, in registry order. */
export function repeatingGroups(): ReadonlyMap<string, readonly ProfileFieldDef[]> {
  const groups = new Map<string, ProfileFieldDef[]>();
  for (const field of PROFILE_FIELDS) {
    if (!field.group) continue;
    const list = groups.get(field.group) ?? [];
    list.push(field);
    groups.set(field.group, list);
  }
  return groups;
}
