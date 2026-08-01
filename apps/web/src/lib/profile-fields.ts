import type { ProfilePack } from '@visastack/core';

/**
 * The canonical Master Profile field registry (Build Spec §4.1; master
 * directive §26 item 5 — Profile PR / Release F). Every manual edit
 * references a key that exists in this registry — fields cannot be invented.
 * Registered idempotently on first edit (`saveFactAction` ->
 * `registerFieldDefinition`).
 *
 * Fields are tagged with a `pack`: **universal** applies to every applicant
 * regardless of visa type (identity, contact, addresses, finances, travel
 * history, refusals, hosts/sponsors, dependants); **professional**,
 * **business**, and **medical** are target-group packs relevant only to the
 * matching visa category. A pack is purely an organizational/UI grouping —
 * nothing prevents an applicant from filling in fields outside their primary
 * pack (e.g. a professional-visa applicant who also has business income).
 *
 * `ProfilePack` itself is canonical in `@visastack/core` (also the grant
 * category vocabulary — packages/services/src/sharing.ts) — re-exported here
 * so existing imports of `ProfilePack` from this module keep working.
 */
export type { ProfilePack };

export interface ProfileFieldDef {
  readonly key: string;
  readonly label: string;
  readonly sensitivity: 'STANDARD' | 'SENSITIVE' | 'RESTRICTED';
  readonly pack: ProfilePack;
  /** Optional input hint for the editor. */
  readonly type?: 'text' | 'date';
  readonly placeholder?: string;
  /**
   * Fields sharing a `group` render together as one repeatable record (Build
   * Spec §4.1: "supports single and repeating records"), e.g. multiple prior
   * visas or multiple past addresses. Each instance is tracked by an
   * independent `repeatingRecordKey`. Absent for single (non-repeating) fields.
   */
  readonly group?: string;
  readonly groupLabel?: string;
}

export const PACK_LABELS: Readonly<Record<ProfilePack, string>> = {
  universal: 'Universal',
  professional: 'Professional / employment',
  business: 'Business / investment',
  medical: 'Medical treatment',
  medical_attendant: 'Medical attendant',
};

export const PACK_DESCRIPTIONS: Readonly<Record<ProfilePack, string>> = {
  universal: 'Identity, contact, and travel history relevant to every visa type.',
  professional: 'Relevant for skilled-worker, employment, and professional visas.',
  business: 'Relevant for investor, entrepreneur, and business-visitor visas.',
  medical: 'Relevant for the traveller receiving medical treatment.',
  medical_attendant:
    "For a companion travelling with and caring for the patient — their own identity and relationship, not more of the patient's medical detail.",
};

/** Packs in the order the editor renders them; universal always comes first. */
export const PACK_ORDER: readonly ProfilePack[] = [
  'universal',
  'professional',
  'business',
  'medical',
  'medical_attendant',
];

export const PROFILE_FIELDS: readonly ProfileFieldDef[] = [
  // --- Universal: identity -------------------------------------------------
  {
    key: 'given_name',
    label: 'Given name',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'As on passport',
  },
  {
    key: 'family_name',
    label: 'Family name',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'As on passport',
  },
  {
    key: 'date_of_birth',
    label: 'Date of birth',
    sensitivity: 'SENSITIVE',
    pack: 'universal',
    type: 'date',
  },
  {
    key: 'nationality',
    label: 'Nationality',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'e.g. Bangladeshi',
  },
  {
    key: 'sex',
    label: 'Sex',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'M / F / X',
  },
  { key: 'passport_number', label: 'Passport number', sensitivity: 'SENSITIVE', pack: 'universal' },
  {
    key: 'passport_expiry',
    label: 'Passport expiry',
    sensitivity: 'STANDARD',
    pack: 'universal',
    type: 'date',
  },
  { key: 'place_of_birth', label: 'Place of birth', sensitivity: 'STANDARD', pack: 'universal' },

  // --- Universal: contact ---------------------------------------------------
  { key: 'email', label: 'Email', sensitivity: 'STANDARD', pack: 'universal' },
  { key: 'phone', label: 'Phone', sensitivity: 'STANDARD', pack: 'universal' },

  // --- Universal: finances ---------------------------------------------------
  { key: 'annual_income', label: 'Annual income', sensitivity: 'SENSITIVE', pack: 'universal' },
  {
    key: 'funding_source',
    label: 'Source of funds',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'e.g. Personal savings, employer sponsorship',
  },

  // --- Universal: repeating — address history --------------------------------
  {
    key: 'address_line',
    label: 'Address',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'address',
    groupLabel: 'Address',
  },
  {
    key: 'address_city',
    label: 'City',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'address',
    groupLabel: 'Address',
  },
  {
    key: 'address_country',
    label: 'Country',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'address',
    groupLabel: 'Address',
  },
  {
    key: 'address_from',
    label: 'From',
    sensitivity: 'STANDARD',
    pack: 'universal',
    type: 'date',
    group: 'address',
    groupLabel: 'Address',
  },
  {
    key: 'address_to',
    label: 'To (leave blank if current)',
    sensitivity: 'STANDARD',
    pack: 'universal',
    type: 'date',
    group: 'address',
    groupLabel: 'Address',
  },

  // --- Universal: repeating — prior visas -------------------------------------
  {
    key: 'prior_visa_country',
    label: 'Issuing country',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'e.g. United States',
    group: 'prior_visa',
    groupLabel: 'Prior visa',
  },
  {
    key: 'prior_visa_type',
    label: 'Visa type',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'e.g. B1/B2 tourist',
    group: 'prior_visa',
    groupLabel: 'Prior visa',
  },
  {
    key: 'prior_visa_number',
    label: 'Visa number',
    sensitivity: 'SENSITIVE',
    pack: 'universal',
    group: 'prior_visa',
    groupLabel: 'Prior visa',
  },
  {
    key: 'prior_visa_validity',
    label: 'Valid from / to',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'e.g. 2022-01 to 2032-01',
    group: 'prior_visa',
    groupLabel: 'Prior visa',
  },

  // --- Universal: repeating — travel history ----------------------------------
  {
    key: 'travel_country',
    label: 'Country visited',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'travel_history',
    groupLabel: 'Travel history',
  },
  {
    key: 'travel_purpose',
    label: 'Purpose',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'e.g. Tourism, conference',
    group: 'travel_history',
    groupLabel: 'Travel history',
  },
  {
    key: 'travel_date',
    label: 'Travel date',
    sensitivity: 'STANDARD',
    pack: 'universal',
    type: 'date',
    group: 'travel_history',
    groupLabel: 'Travel history',
  },

  // --- Universal: repeating — visa refusals -----------------------------------
  {
    key: 'refusal_country',
    label: 'Refusing country',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'visa_refusal',
    groupLabel: 'Visa refusal',
  },
  {
    key: 'refusal_date',
    label: 'Date',
    sensitivity: 'STANDARD',
    pack: 'universal',
    type: 'date',
    group: 'visa_refusal',
    groupLabel: 'Visa refusal',
  },
  {
    key: 'refusal_reason',
    label: 'Stated reason',
    sensitivity: 'SENSITIVE',
    pack: 'universal',
    group: 'visa_refusal',
    groupLabel: 'Visa refusal',
  },

  // --- Universal: repeating — hosts / sponsors --------------------------------
  {
    key: 'sponsor_name',
    label: 'Name',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'sponsor',
    groupLabel: 'Host / sponsor',
  },
  {
    key: 'sponsor_relationship',
    label: 'Relationship',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'sponsor',
    groupLabel: 'Host / sponsor',
  },
  {
    key: 'sponsor_address',
    label: 'Address',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'sponsor',
    groupLabel: 'Host / sponsor',
  },
  {
    key: 'sponsor_contact',
    label: 'Contact (email or phone)',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'sponsor',
    groupLabel: 'Host / sponsor',
  },

  // --- Universal: repeating — dependants --------------------------------------
  {
    key: 'dependant_name',
    label: 'Name',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'dependant',
    groupLabel: 'Dependant',
  },
  {
    key: 'dependant_relationship',
    label: 'Relationship',
    sensitivity: 'STANDARD',
    pack: 'universal',
    placeholder: 'e.g. Spouse, child',
    group: 'dependant',
    groupLabel: 'Dependant',
  },
  {
    key: 'dependant_date_of_birth',
    label: 'Date of birth',
    sensitivity: 'SENSITIVE',
    pack: 'universal',
    type: 'date',
    group: 'dependant',
    groupLabel: 'Dependant',
  },
  {
    key: 'dependant_nationality',
    label: 'Nationality',
    sensitivity: 'STANDARD',
    pack: 'universal',
    group: 'dependant',
    groupLabel: 'Dependant',
  },

  // --- Professional / employment ----------------------------------------------
  {
    key: 'current_employer',
    label: 'Current employer',
    sensitivity: 'STANDARD',
    pack: 'professional',
  },
  { key: 'job_title', label: 'Job title', sensitivity: 'STANDARD', pack: 'professional' },
  {
    key: 'monthly_salary',
    label: 'Monthly salary',
    sensitivity: 'SENSITIVE',
    pack: 'professional',
  },
  {
    key: 'employer_name',
    label: 'Employer name',
    sensitivity: 'STANDARD',
    pack: 'professional',
    group: 'employment_history',
    groupLabel: 'Employment history',
  },
  {
    key: 'employer_job_title',
    label: 'Job title',
    sensitivity: 'STANDARD',
    pack: 'professional',
    group: 'employment_history',
    groupLabel: 'Employment history',
  },
  {
    key: 'employer_country',
    label: 'Country',
    sensitivity: 'STANDARD',
    pack: 'professional',
    group: 'employment_history',
    groupLabel: 'Employment history',
  },
  {
    key: 'employment_start',
    label: 'Start date',
    sensitivity: 'STANDARD',
    pack: 'professional',
    type: 'date',
    group: 'employment_history',
    groupLabel: 'Employment history',
  },
  {
    key: 'employment_end',
    label: 'End date (leave blank if current)',
    sensitivity: 'STANDARD',
    pack: 'professional',
    type: 'date',
    group: 'employment_history',
    groupLabel: 'Employment history',
  },
  {
    key: 'institution_name',
    label: 'Institution',
    sensitivity: 'STANDARD',
    pack: 'professional',
    group: 'education_history',
    groupLabel: 'Education',
  },
  {
    key: 'degree',
    label: 'Degree',
    sensitivity: 'STANDARD',
    pack: 'professional',
    group: 'education_history',
    groupLabel: 'Education',
  },
  {
    key: 'field_of_study',
    label: 'Field of study',
    sensitivity: 'STANDARD',
    pack: 'professional',
    group: 'education_history',
    groupLabel: 'Education',
  },
  {
    key: 'graduation_date',
    label: 'Graduation date',
    sensitivity: 'STANDARD',
    pack: 'professional',
    type: 'date',
    group: 'education_history',
    groupLabel: 'Education',
  },

  // --- Business / investment -----------------------------------------------
  { key: 'company_name', label: 'Company name', sensitivity: 'STANDARD', pack: 'business' },
  {
    key: 'company_registration_number',
    label: 'Registration number',
    sensitivity: 'SENSITIVE',
    pack: 'business',
  },
  {
    key: 'business_type',
    label: 'Business type',
    sensitivity: 'STANDARD',
    pack: 'business',
    placeholder: 'e.g. Sole proprietorship, LLC',
  },
  {
    key: 'investment_amount',
    label: 'Investment amount',
    sensitivity: 'SENSITIVE',
    pack: 'business',
  },
  {
    key: 'ownership_percentage',
    label: 'Ownership %',
    sensitivity: 'STANDARD',
    pack: 'business',
  },

  // --- Medical treatment -----------------------------------------------------
  {
    key: 'health_insurance_provider',
    label: 'Insurance provider',
    sensitivity: 'STANDARD',
    pack: 'medical',
  },
  {
    key: 'health_insurance_policy_number',
    label: 'Policy number',
    sensitivity: 'SENSITIVE',
    pack: 'medical',
  },
  {
    key: 'health_insurance_validity',
    label: 'Policy valid until',
    sensitivity: 'STANDARD',
    pack: 'medical',
    type: 'date',
  },
  {
    key: 'medical_condition_summary',
    label: 'Condition summary',
    sensitivity: 'RESTRICTED',
    pack: 'medical',
  },
  {
    key: 'treating_physician',
    label: 'Treating physician',
    sensitivity: 'STANDARD',
    pack: 'medical',
  },
  {
    key: 'treating_facility',
    label: 'Treating facility',
    sensitivity: 'STANDARD',
    pack: 'medical',
  },

  // --- Medical attendant -------------------------------------------------
  {
    key: 'attendant_full_name',
    label: 'Full name',
    sensitivity: 'STANDARD',
    pack: 'medical_attendant',
    placeholder: 'As on passport',
  },
  {
    key: 'attendant_relationship_to_patient',
    label: 'Relationship to patient',
    sensitivity: 'STANDARD',
    pack: 'medical_attendant',
    placeholder: 'e.g. Spouse, adult child, professional caregiver',
  },
  {
    key: 'attendant_passport_number',
    label: 'Passport number',
    sensitivity: 'SENSITIVE',
    pack: 'medical_attendant',
  },
  {
    key: 'attendant_passport_expiry',
    label: 'Passport expiry',
    sensitivity: 'STANDARD',
    pack: 'medical_attendant',
    type: 'date',
  },
  {
    key: 'attendant_role_description',
    label: 'Role during treatment',
    sensitivity: 'STANDARD',
    pack: 'medical_attendant',
    placeholder: 'e.g. Daily care, translation, medical decision support',
  },
  {
    key: 'attendant_return_travel_plan',
    label: 'Return travel plan',
    sensitivity: 'STANDARD',
    pack: 'medical_attendant',
    placeholder: 'Whether they leave with or separately from the patient',
  },
] as const;

const BY_KEY = new Map(PROFILE_FIELDS.map((f) => [f.key, f]));

export function profileField(key: string): ProfileFieldDef | undefined {
  return BY_KEY.get(key);
}

/** Non-repeating fields for one pack, in registry order. */
export function singleFields(pack: ProfilePack): readonly ProfileFieldDef[] {
  return PROFILE_FIELDS.filter((f) => f.pack === pack && !f.group);
}

/** Repeating fields for one pack, grouped by their `group` key, in registry order. */
export function repeatingGroups(
  pack: ProfilePack,
): ReadonlyMap<string, readonly ProfileFieldDef[]> {
  const groups = new Map<string, ProfileFieldDef[]>();
  for (const field of PROFILE_FIELDS) {
    if (field.pack !== pack || !field.group) continue;
    const list = groups.get(field.group) ?? [];
    list.push(field);
    groups.set(field.group, list);
  }
  return groups;
}
