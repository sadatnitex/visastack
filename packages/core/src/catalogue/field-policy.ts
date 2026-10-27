import { CATALOGUE_FIELDS } from './fields';
import { LEGACY_FIELD_SNAPSHOT } from './legacy';
import type { FieldKind, FieldSensitivity, LayerKey } from './types';

/**
 * What the sharing and output rules need to know about one field, whether it is live today or
 * added by the catalogue: its layer, its kind (which decides how it may leave the record) and its
 * protection level.
 *
 * Catalogue fields carry their kind. The 81 live fields predate kinds, so their kinds are written
 * out here once, and a test refuses a live field that is protected but has no kind, so a new one
 * cannot slip through as "general".
 */
export interface FieldPolicy {
  readonly key: string;
  readonly label: string;
  readonly layer: LayerKey;
  readonly kind: FieldKind;
  readonly sensitivity: FieldSensitivity;
  /** The repeating record the field belongs to, if any. */
  readonly group?: string;
  readonly groupLabel?: string;
}

/**
 * The kind of every live field that is not "general". Anything not listed here is general, and the
 * test in field-policy.test.ts proves a live field with protection above Standard is always listed.
 */
export const LEGACY_FIELD_KINDS: Readonly<Record<string, FieldKind>> = {
  date_of_birth: 'personal_date',
  dependant_date_of_birth: 'personal_date',
  passport_number: 'identifier',
  historical_passport_number: 'identifier',
  prior_visa_number: 'identifier',
  health_insurance_policy_number: 'identifier',
  attendant_passport_number: 'identifier',
  company_registration_number: 'identifier',
  annual_income: 'amount',
  monthly_salary: 'amount',
  self_employment_income: 'amount',
  investment_amount: 'amount',
  refusal_reason: 'legal_history',
  medical_condition_summary: 'health_detail',
};

const POLICY_BY_KEY: ReadonlyMap<string, FieldPolicy> = (() => {
  const policies = new Map<string, FieldPolicy>();
  for (const field of LEGACY_FIELD_SNAPSHOT) {
    policies.set(field.key, {
      key: field.key,
      label: field.label,
      layer: field.layer,
      kind: LEGACY_FIELD_KINDS[field.key] ?? 'general',
      sensitivity: field.sensitivity,
      ...(field.group ? { group: field.group } : {}),
      ...(field.groupLabel ? { groupLabel: field.groupLabel } : {}),
    });
  }
  for (const field of CATALOGUE_FIELDS) {
    if (policies.has(field.key)) continue;
    policies.set(field.key, {
      key: field.key,
      label: field.label,
      layer: field.layer,
      kind: field.kind,
      sensitivity: field.sensitivity,
      ...(field.group ? { group: field.group } : {}),
      ...(field.groupLabel ? { groupLabel: field.groupLabel } : {}),
    });
  }
  return policies;
})();

/** The policy of a field, or undefined for a key the catalogue does not know (callers fail closed). */
export function fieldPolicyOf(key: string): FieldPolicy | undefined {
  return POLICY_BY_KEY.get(key);
}
