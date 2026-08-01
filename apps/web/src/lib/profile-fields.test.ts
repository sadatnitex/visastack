import { describe, expect, it } from 'vitest';
import {
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
    expect(profileField('passport_number')?.label).toBe('Passport number');
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
});
