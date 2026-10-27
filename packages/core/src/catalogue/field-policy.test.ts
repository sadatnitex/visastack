import { describe, expect, it } from 'vitest';
import { LEGACY_FIELD_KINDS, fieldPolicyOf } from './field-policy';
import { CATALOGUE_FIELDS } from './fields';
import { LEGACY_FIELD_SNAPSHOT } from './legacy';
import { FIELD_KINDS, PROTECTION_FLOOR, sensitivityAtLeast } from './types';

/**
 * The live fields are frozen (see legacy.ts), so a live field stored below its kind's floor cannot be
 * raised here. The output rules use the kind, not the stored level, so the kind is still right. Each
 * one is listed on purpose; a new entry needs a reason.
 */
const LIVE_FIELDS_STORED_BELOW_FLOOR: ReadonlySet<string> = new Set([
  // Stored as Sensitive when it went live; its kind is legal history, which only the declarations layer may share.
  'refusal_reason',
]);

describe('field policy', () => {
  it('knows every live and every catalogue field', () => {
    for (const field of [...LEGACY_FIELD_SNAPSHOT, ...CATALOGUE_FIELDS]) {
      expect(fieldPolicyOf(field.key), field.key).toBeDefined();
    }
  });

  it('does not know a key the catalogue never defined', () => {
    expect(fieldPolicyOf('not_a_field')).toBeUndefined();
  });

  it('names a kind for every live field that is protected above Standard', () => {
    for (const field of LEGACY_FIELD_SNAPSHOT) {
      if (field.sensitivity === 'STANDARD') continue;
      expect(LEGACY_FIELD_KINDS[field.key], `${field.key} needs a kind`).toBeDefined();
    }
  });

  it('lists only live fields, with real kinds, and never lowers a protection floor', () => {
    const live = new Map(LEGACY_FIELD_SNAPSHOT.map((field) => [field.key, field]));
    for (const [key, kind] of Object.entries(LEGACY_FIELD_KINDS)) {
      const field = live.get(key);
      expect(field, `${key} is not a live field`).toBeDefined();
      expect(FIELD_KINDS).toContain(kind);
      expect(
        sensitivityAtLeast(field?.sensitivity ?? 'STANDARD', PROTECTION_FLOOR[kind]) ||
          LIVE_FIELDS_STORED_BELOW_FLOOR.has(key),
        `${key} is protected below its kind`,
      ).toBe(true);
    }
  });

  it('pins the layer of every live field whose kind decides how it may be shared', () => {
    // The output rules grant a field through its layer. The live list says a layer is "presentation
    // only", so moving one of these between layers must be a deliberate change made here as well.
    const pinned: Readonly<Record<string, string>> = {
      date_of_birth: 'identity',
      dependant_date_of_birth: 'people',
      passport_number: 'travel_documents',
      historical_passport_number: 'travel_documents',
      prior_visa_number: 'travel_documents',
      health_insurance_policy_number: 'health',
      attendant_passport_number: 'people',
      company_registration_number: 'purpose_packs',
      annual_income: 'money',
      monthly_salary: 'timelines',
      self_employment_income: 'timelines',
      investment_amount: 'purpose_packs',
      refusal_reason: 'declarations',
      medical_condition_summary: 'health',
    };
    expect(Object.keys(pinned).sort()).toEqual(Object.keys(LEGACY_FIELD_KINDS).sort());
    for (const [key, layer] of Object.entries(pinned)) {
      expect(fieldPolicyOf(key)?.layer, key).toBe(layer);
    }
  });

  it('gives the passport number the identifier kind and the national ID its stronger one', () => {
    expect(fieldPolicyOf('passport_number')?.kind).toBe('identifier');
    expect(fieldPolicyOf('nid_number')?.kind).toBe('national_identifier');
    expect(fieldPolicyOf('given_name')?.kind).toBe('general');
  });
});
