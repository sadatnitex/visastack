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
});
