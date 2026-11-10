import { describe, expect, it } from 'vitest';
import { casePurposeGroups, savedPurposeMark } from './case-choices';
import { COMMON_PURPOSE_KEYS } from './common-purposes';
import { purposeMark } from './item-icons';

describe('the eight common purposes (P15)', () => {
  const groups = casePurposeGroups();
  const byKey = new Map(
    groups.flatMap((g) => g.options.map((o) => [o.key, { ...o, family: g.family }] as const)),
  );

  it('are eight different keys, every one a purpose the picker offers', () => {
    expect(COMMON_PURPOSE_KEYS).toHaveLength(8);
    expect(new Set(COMMON_PURPOSE_KEYS).size).toBe(8);
    for (const key of COMMON_PURPOSE_KEYS) expect(byKey.has(key), key).toBe(true);
  });

  it('cover a holiday, family, business, study, work, treatment, Hajj or Umrah and transit', () => {
    expect(COMMON_PURPOSE_KEYS.map((key) => byKey.get(key)?.family)).toEqual([
      'visit',
      'visit',
      'visit',
      'study',
      'work',
      'visit',
      'visit',
      'visit',
    ]);
    expect(byKey.get('religious_travel')?.label).toContain('Hajj');
  });

  it('each read as a different picture, so the tiles tell themselves apart', () => {
    const pictures = COMMON_PURPOSE_KEYS.map(
      (key) => purposeMark(key, byKey.get(key)?.family).icon,
    );
    expect(new Set(pictures).size).toBe(8);
  });
});

describe('the picture of a saved purpose', () => {
  it('is found from the label a case saved, and from the key', () => {
    expect(savedPurposeMark('Tourism')?.icon).toBe('tripTourist');
    expect(savedPurposeMark('  medical treatment ')?.icon).toBe('tripMedical');
    expect(savedPurposeMark('religious_travel')?.icon).toBe('tripPilgrim');
  });

  it('is nothing for words the picker does not offer, never a guess', () => {
    expect(savedPurposeMark('Seeing my cousin')).toBeNull();
    expect(savedPurposeMark('')).toBeNull();
    expect(savedPurposeMark(null)).toBeNull();
    expect(savedPurposeMark(undefined)).toBeNull();
  });

  it('gives every purpose the picker offers a picture', () => {
    for (const group of casePurposeGroups()) {
      for (const option of group.options) {
        expect(savedPurposeMark(option.label), option.key).not.toBeNull();
      }
    }
  });
});
