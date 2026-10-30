import { describe, expect, it } from 'vitest';
import { CATALOGUE_FIELDS } from './fields';
import { LEGACY_FIELD_SNAPSHOT } from './legacy';
import { fieldRegistryInput, savableFieldDefinition } from './registry-shape';

describe('the one registry shape every writer uses (S21 round 3)', () => {
  it('reads a live field from the live list, never from a catalogue entry with the same key', () => {
    for (const live of LEGACY_FIELD_SNAPSHOT) {
      expect(savableFieldDefinition(live.key)).toEqual({
        key: live.key,
        label: live.label,
        sensitivity: live.sensitivity,
        type: live.type,
        repeating: live.group !== undefined,
        packId: live.pack,
      });
    }
  });

  it('reads an added field from the catalogue', () => {
    const live = new Set(LEGACY_FIELD_SNAPSHOT.map((field) => field.key));
    const added = CATALOGUE_FIELDS.find((field) => !live.has(field.key) && field.type === 'date');
    if (!added) throw new Error('no added date field');
    expect(fieldRegistryInput(added.key)).toEqual({
      key: added.key,
      dataType: 'date',
      sensitivity: added.sensitivity,
      repeating: added.group !== undefined,
      packId: added.pack,
    });
  });

  it('stores text as "string" and knows nothing of an unknown key', () => {
    expect(fieldRegistryInput('phone')?.dataType).toBe('string');
    expect(fieldRegistryInput('made_up_field')).toBeUndefined();
    expect(savableFieldDefinition('made_up_field')).toBeUndefined();
  });
});
