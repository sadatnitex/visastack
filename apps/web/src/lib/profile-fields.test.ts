import { describe, expect, it } from 'vitest';
import {
  ISO_CURRENCY_CODES,
  PACK_LABELS,
  PACK_ORDER,
  PROFILE_FIELDS,
  profileField,
  repeatingGroups,
  singleFields,
} from './profile-fields';

describe('profile field registry (Release F)', () => {
  it('has no duplicate field keys across every pack', () => {
    const keys = PROFILE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves a known key and returns undefined for an unknown one', () => {
    expect(profileField('passport_number')?.label).toBe('Passport Number');
    expect(profileField('not_a_real_field')).toBeUndefined();
  });

  it('every field belongs to a pack declared in PACK_ORDER', () => {
    for (const field of PROFILE_FIELDS) {
      expect(PACK_ORDER).toContain(field.pack);
    }
  });

  it('every field has a non-empty label and a valid sensitivity', () => {
    for (const field of PROFILE_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0);
      expect(['STANDARD', 'SENSITIVE', 'RESTRICTED']).toContain(field.sensitivity);
    }
  });

  it('singleFields/repeatingGroups partition each pack completely (no field lost or duplicated)', () => {
    for (const pack of PACK_ORDER) {
      const singles = singleFields(pack);
      const groups = repeatingGroups(pack);
      const groupedCount = [...groups.values()].reduce((sum, fields) => sum + fields.length, 0);
      const expectedTotal = PROFILE_FIELDS.filter((f) => f.pack === pack).length;
      expect(singles.length + groupedCount).toBe(expectedTotal);
    }
  });

  it('singleFields/repeatingGroups never cross pack boundaries', () => {
    for (const pack of PACK_ORDER) {
      for (const field of singleFields(pack)) {
        expect(field.pack).toBe(pack);
      }
      for (const fields of repeatingGroups(pack).values()) {
        for (const field of fields) {
          expect(field.pack).toBe(pack);
        }
      }
    }
  });

  it('every repeating field declares a groupLabel', () => {
    for (const field of PROFILE_FIELDS) {
      if (field.group) expect(field.groupLabel).toBeTruthy();
    }
  });

  it('has a human label for every pack in PACK_ORDER', () => {
    for (const pack of PACK_ORDER) {
      expect(PACK_LABELS[pack]).toBeTruthy();
    }
  });

  it('universal is the first pack (renders un-collapsed)', () => {
    expect(PACK_ORDER[0]).toBe('universal');
  });

  it('has a distinct medical_attendant pack, separate from the patient\'s own medical pack (master directive §7 "PR 8")', () => {
    expect(PACK_ORDER).toContain('medical_attendant');
    const attendantFields = PROFILE_FIELDS.filter((f) => f.pack === 'medical_attendant');
    expect(attendantFields.length).toBeGreaterThan(0);
    // No overlap with the patient's own medical fields — an attendant's
    // record is a distinct identity, not additional detail on the patient.
    const medicalKeys = new Set(
      PROFILE_FIELDS.filter((f) => f.pack === 'medical').map((f) => f.key),
    );
    for (const field of attendantFields) {
      expect(medicalKeys.has(field.key)).toBe(false);
    }
  });

  describe('PRO-01 §2 section coverage', () => {
    it('covers every section PRO-01 names: identity/contact, nationality/residence, current+historical passports, addresses, family basics, education, employment, self-employment, sponsor context, basic financial declarations, travel/visa/refusal history', () => {
      const keys = new Set(PROFILE_FIELDS.map((f) => f.key));
      const mustExist = [
        'given_name',
        'family_name', // identity
        'email',
        'phone', // contact
        'nationality',
        'country_of_residence', // nationality/residence
        'passport_number',
        'passport_expiry', // current passport
        'historical_passport_number', // historical passport
        'address_line', // addresses
        'dependant_name',
        'marital_status', // family basics
        'institution_name',
        'degree', // education
        'current_employer',
        'employer_name', // employment
        'self_employment_nature', // self-employment
        'sponsor_name', // sponsor context
        'annual_income',
        'funding_source', // basic financial declarations
        'travel_country', // travel history
        'prior_visa_country', // visa history
        'refusal_country', // refusal history
      ];
      for (const key of mustExist) {
        expect(keys.has(key), `expected field "${key}" to exist`).toBe(true);
      }
    });

    it('keeps the single current-passport fields untouched by the new historical-passport group (additive only, no data migration)', () => {
      expect(profileField('passport_number')?.group).toBeUndefined();
      expect(profileField('passport_expiry')?.group).toBeUndefined();
      expect(profileField('historical_passport_number')?.group).toBe('historical_passport');
    });

    it('a currency field pairs a decimal amount with a select of ISO codes, never one unstructured string (PRO-01 §2 "Currency: decimal + ISO currency")', () => {
      for (const amountKey of ['annual_income', 'monthly_salary', 'investment_amount']) {
        const amount = profileField(amountKey);
        const currency = profileField(`${amountKey}_currency`);
        expect(amount, `expected amount field "${amountKey}"`).toBeDefined();
        expect(currency, `expected paired currency field "${amountKey}_currency"`).toBeDefined();
        expect(currency?.options).toBe(ISO_CURRENCY_CODES);
      }
    });

    it('ISO_CURRENCY_CODES has no duplicates and covers the operating region plus major global currencies', () => {
      expect(new Set(ISO_CURRENCY_CODES).size).toBe(ISO_CURRENCY_CODES.length);
      for (const code of ['BDT', 'USD', 'SGD', 'EUR', 'GBP']) {
        expect(ISO_CURRENCY_CODES).toContain(code);
      }
    });

    it('every field with `options` has at least two non-empty choices', () => {
      for (const field of PROFILE_FIELDS) {
        if (!field.options) continue;
        expect(field.options.length).toBeGreaterThanOrEqual(2);
        for (const opt of field.options) expect(opt.length).toBeGreaterThan(0);
      }
    });
  });
});
