import { describe, expect, it } from 'vitest';
import {
  type LegacyFactsShape,
  type SnapshotFactEntry,
  normalizeSnapshotFacts,
} from './snapshot-facts';

/**
 * Finding #29 (post-programme defect register): pre-PR-10 (PR #63) snapshots
 * wrote `content.facts` as a plain fieldKey->value object, not an array —
 * the current read page's unguarded `.map()` threw on any such row, making
 * every snapshot captured before that PR permanently unreadable. No prior
 * test coverage existed for this page at all.
 */
describe('normalizeSnapshotFacts — reads both the legacy object shape and the current array shape (finding #29)', () => {
  it('passes a post-PR-10 array shape through unchanged', () => {
    const modern: readonly SnapshotFactEntry[] = [
      {
        fieldKey: 'given_name',
        factId: 'fact-1',
        factVersionId: 'fv-1',
        repeatingRecordKey: null,
        value: 'Jane',
        status: 'APPLICANT_CONFIRMED',
        evidenceLinkIds: ['ev-1'],
      },
    ];
    expect(normalizeSnapshotFacts(modern)).toBe(modern);
  });

  it('normalizes a pre-PR-10 object shape into the current array shape, without throwing', () => {
    const legacy: LegacyFactsShape = {
      given_name: 'Jane',
      family_name: 'Doe',
    };

    expect(() => normalizeSnapshotFacts(legacy)).not.toThrow();
    const normalized = normalizeSnapshotFacts(legacy);
    expect(normalized).toHaveLength(2);

    const givenName = normalized.find((f) => f.fieldKey === 'given_name');
    expect(givenName?.value).toBe('Jane');
    // Fields the legacy write never recorded are reported honestly, never
    // fabricated to look like real provenance.
    expect(givenName?.factVersionId).toBeNull();
    expect(givenName?.repeatingRecordKey).toBeNull();
    expect(givenName?.evidenceLinkIds).toEqual([]);
    // factId is synthesized from the field key (stable, unique within one
    // snapshot) purely as a React list key — never a real database reference.
    expect(givenName?.factId).toBe('given_name');

    const familyName = normalized.find((f) => f.fieldKey === 'family_name');
    expect(familyName?.value).toBe('Doe');
  });

  it('normalizes a legacy fact whose value was null the same as any other', () => {
    const legacy: LegacyFactsShape = { middle_name: null };
    const normalized = normalizeSnapshotFacts(legacy);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.value).toBeNull();
  });

  it('normalizes an empty legacy object to an empty array, matching the empty-array case', () => {
    const legacy: LegacyFactsShape = {};
    expect(normalizeSnapshotFacts(legacy)).toEqual([]);
  });
});
