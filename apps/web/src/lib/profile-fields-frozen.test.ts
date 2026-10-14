import {
  CATALOGUE_FIELDS,
  LEGACY_FIELD_SNAPSHOT,
  LEGACY_GROUP_KEYS,
} from '@visastack/core/catalogue';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_TYPE_LABELS } from './labels';
import { PROFILE_FIELDS } from './profile-fields';

/**
 * Guards the live field registry against silent change.
 *
 * Field definitions are registered lazily and the first writer wins, so a key, category, protection
 * level or type edited here after values exist disagrees with what is stored. The frozen copy lives
 * in packages/core/src/catalogue/legacy.ts. To change a live field on purpose, change both in the
 * same commit and record why in docs/product/master-profile-enrichment/HANDOFF.md.
 */
describe('live profile fields are frozen to the catalogue snapshot', () => {
  const live = PROFILE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    sensitivity: f.sensitivity,
    pack: f.pack,
    type: f.type ?? 'text',
    ...(f.group ? { group: f.group, groupLabel: f.groupLabel } : {}),
    ...(f.options ? { options: f.options } : {}),
  }));
  // The layer and the Other text box belong to the catalogue, not to the frozen identity of a field.
  const frozen = LEGACY_FIELD_SNAPSHOT.map(
    ({ layer: _layer, otherDetailKey: _other, ...rest }) => rest,
  );

  it('matches the snapshot field by field, in order', () => {
    expect(live).toEqual(frozen);
  });

  it('has the same repeating records', () => {
    const groups = [...new Set(PROFILE_FIELDS.flatMap((f) => (f.group ? [f.group] : [])))].sort();
    expect(groups).toEqual([...LEGACY_GROUP_KEYS].sort());
  });

  it('is never repeated by a catalogue field', () => {
    const liveKeys = new Set(PROFILE_FIELDS.map((f) => f.key));
    for (const field of CATALOGUE_FIELDS) expect(liveKeys.has(field.key), field.key).toBe(false);
  });
});

describe('document names shown today agree with the catalogue', () => {
  it('shows the same name for the three types the product knows', async () => {
    const { CATALOGUE_DOCUMENTS } = await import('@visastack/core/catalogue');
    for (const [key, label] of Object.entries(DOCUMENT_TYPE_LABELS)) {
      expect(CATALOGUE_DOCUMENTS.find((d) => d.key === key)?.label, key).toBe(label);
    }
  });
});
