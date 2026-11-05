import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_GROUP_TONE,
  type RequirementDetailRow,
  buildCaseAttention,
  buildChecklistGroups,
  categoryProgress,
  plainRequirementCount,
  toneOfBadge,
} from './case-model';

const row = (
  id: string,
  state: RequirementDetailRow['state'],
  extra: Partial<RequirementDetailRow> = {},
): RequirementDetailRow => ({
  packRequirementId: id,
  kind: 'DOCUMENT',
  key: id,
  optional: false,
  state,
  citation: '',
  sourceTitle: null,
  sourceUrl: null,
  publisher: null,
  observedDate: null,
  sourceInaccessible: false,
  category: 'FINANCIAL_MEANS',
  ...extra,
});

describe('plainRequirementCount', () => {
  it('words the shared sentences for one item and for many', () => {
    expect(plainRequirementCount('1 requirement(s) still needed', 1)).toBe(
      '1 required item still needed',
    );
    expect(plainRequirementCount('4 requirement(s) still needed', 4)).toBe(
      '4 required items still needed',
    );
    expect(plainRequirementCount('1 requirement(s) need more information to confirm.', 1)).toBe(
      '1 required item needs more information to confirm.',
    );
    expect(plainRequirementCount('2 requirement(s) need more information to confirm.', 2)).toBe(
      '2 required items need more information to confirm.',
    );
  });

  it('leaves any other sentence, in any language, exactly as it is', () => {
    expect(plainRequirementCount('All required items are provided.', 0)).toBe(
      'All required items are provided.',
    );
    expect(plainRequirementCount('4টি প্রয়োজনীয় নথি এখনও বাকি', 4)).toBe('4টি প্রয়োজনীয় নথি এখনও বাকি');
  });
});

describe('categoryProgress', () => {
  it('counts what is on file out of what counts, across the whole checklist', () => {
    const progress = categoryProgress([
      row('a', 'SATISFIED'),
      row('b', 'CRITICAL_GAP'),
      row('c', 'UNVERIFIED'),
      // Does not apply, or is covered by another alternative: not counted at all.
      row('d', 'NOT_APPLICABLE'),
      row('e', 'SATISFIED', { coveredByAlternative: true }),
      row('f', 'SATISFIED', { category: 'IDENTITY_TRAVEL_DOCUMENTS' }),
      row('g', 'SATISFIED', { category: null }),
    ]);
    expect(progress.get('FINANCIAL_MEANS')).toEqual({ onFile: 1, total: 3 });
    expect(progress.get('IDENTITY_TRAVEL_DOCUMENTS')).toEqual({ onFile: 1, total: 1 });
    expect(progress.get('other')).toEqual({ onFile: 1, total: 1 });
  });
});

describe('the attention chips and the groups share one count', () => {
  it('says "to fix" with the same count the checklist group holds', () => {
    const rows = [
      row('a', 'CRITICAL_GAP'),
      row('b', 'CONFLICTING'),
      row('c', 'EXPIRING_STALE'),
      row('d', 'UNVERIFIED'),
    ];
    const toFix = rows.filter((r) =>
      ['CRITICAL_GAP', 'CONFLICTING', 'EXPIRING_STALE'].includes(r.state),
    ).length;
    const chips = buildCaseAttention({
      isDirty: false,
      hasReadiness: true,
      hasChecklist: true,
      requiredHardGapCount: toFix,
      requiredUnverifiedCount: 1,
      expiringDocumentCount: 0,
      tripChecksToAct: 0,
      openTasks: 0,
    });
    expect(chips[0]).toMatchObject({ kind: 'missing', count: 3, label: 'required items to fix' });
    const needsYou = buildChecklistGroups(rows).find((g) => g.key === 'needs-you');
    expect(needsYou?.rows).toHaveLength(chips[0]?.count ?? -1);
    expect(CHECKLIST_GROUP_TONE['needs-you']).toBe('danger');
  });

  it('says the singular for one required item to fix', () => {
    const [chip] = buildCaseAttention({
      isDirty: false,
      hasReadiness: true,
      hasChecklist: true,
      requiredHardGapCount: 1,
      requiredUnverifiedCount: 0,
      expiringDocumentCount: 0,
      tripChecksToAct: 0,
      openTasks: 0,
    });
    expect(chip?.label).toBe('required item to fix');
  });
});

describe('toneOfBadge', () => {
  it('turns a badge class into a tone, and anything else into neutral', () => {
    expect(toneOfBadge('badge-danger')).toBe('danger');
    expect(toneOfBadge('badge-success')).toBe('success');
    expect(toneOfBadge('badge-warning')).toBe('warning');
    expect(toneOfBadge('badge-neutral')).toBe('neutral');
    expect(toneOfBadge('badge')).toBe('neutral');
  });
});
