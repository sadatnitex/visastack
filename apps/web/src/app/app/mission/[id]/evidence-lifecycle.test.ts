import { describe, expect, it } from 'vitest';
import { evidenceDocumentIds, evidenceLifecycleLabels } from './evidence-lifecycle';

const now = new Date('2026-11-05T12:00:00Z');
const life = (state: 'CURRENT' | 'ARCHIVED' | 'RECENTLY_DELETED' | 'REMOVING', replaced = false) =>
  ({
    state,
    replaced,
    archivedAt: null,
    deletedAt:
      state === 'CURRENT' || state === 'ARCHIVED' ? null : new Date('2026-11-03T09:00:00Z'),
    purgeAfter: null,
    deletePath: state === 'REMOVING' ? ('REQUEST' as const) : null,
  }) as const;

const entries = [
  {
    packRequirementId: 'q1',
    documentCandidates: [{ documentId: 'a' }, { documentId: 'b' }],
    selectedDocumentIds: ['a', 'gone'],
  },
  { packRequirementId: 'q2', documentCandidates: [{ documentId: 'b' }], selectedDocumentIds: [] },
];

describe('evidence lifecycle labels (lane Z)', () => {
  it('lists every candidate and chosen document once', () => {
    expect(evidenceDocumentIds(entries)).toEqual(['a', 'b', 'gone']);
  });

  it('labels archived, replaced and removed documents; a current one has none', () => {
    const labels = evidenceLifecycleLabels(
      entries,
      new Map([
        ['a', life('ARCHIVED')],
        ['b', life('CURRENT', true)],
        ['gone', life('REMOVING')],
      ]),
      now,
    );
    expect(labels.byDocument).toEqual({
      a: 'Archived',
      b: 'Replaced',
      gone: 'Removed by the traveller on 3 Nov',
    });
    // Only the documents a requirement chose show on its line.
    expect(labels.chosenByRequirement).toEqual({
      q1: ['Archived', 'Removed by the traveller on 3 Nov'],
    });
  });

  it('says nothing when every document is current or unknown', () => {
    const labels = evidenceLifecycleLabels(entries, new Map([['a', life('CURRENT')]]), now);
    expect(labels).toEqual({ byDocument: {}, chosenByRequirement: {} });
  });
});
