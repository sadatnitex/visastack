import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';
import type { RequirementDetailRow } from './case-model';
import { officialLabel, requirementLabel } from './case-model';

/** The traveller's own wording on a checklist row (synthetic values only). */

vi.mock('./wording-editor', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { WordingEditor: stub('WordingEditor') };
});
vi.mock('./readiness-gap-explain', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { ExplainGapButton: stub('ExplainGapButton') };
});
vi.mock('./suggest-correction', () => {
  return {
    SuggestCorrection: ({ itemName }: { itemName: string }) => (
      <span data-suggest={itemName}>{`Suggest: ${itemName}`}</span>
    ),
  };
});

const { CaseChecklist } = await import('./case-checklist');

function row(over: Partial<RequirementDetailRow> = {}): RequirementDetailRow {
  return {
    packRequirementId: '30000000-0000-4000-8000-000000000001',
    kind: 'DOCUMENT',
    key: 'PASSPORT',
    optional: false,
    state: 'CRITICAL_GAP',
    citation: 'Synthetic rule',
    sourceTitle: null,
    sourceUrl: null,
    publisher: null,
    observedDate: null,
    sourceInaccessible: false,
    category: null,
    necessity: 'MANDATORY',
    ...over,
  };
}

const props = (rows: RequirementDetailRow[], wordingEditable = true) => ({
  missionId: '20000000-0000-4000-8000-000000000001',
  applicantId: '10000000-0000-4000-8000-000000000001',
  rows,
  chosenByRequirement: {},
  explanations: { configured: false, off: undefined, byRequirement: new Map() },
  packName: 'Synthetic Checklist',
  wordingEditable,
});

describe('label precedence', () => {
  it("puts the traveller's words first and keeps the official name for summaries", () => {
    const r = row({ wording: 'Valid passport, six months.', myWording: 'My passport' });
    expect(requirementLabel(r)).toBe('My passport');
    expect(officialLabel(r)).toBe('Valid passport, six months.');
    expect(requirementLabel(row())).toBe(officialLabel(row()));
  });
});

describe('the checklist with the traveller wording', () => {
  it('shows the traveller title, the original sentence, a tag, and an edit control', async () => {
    const html = await renderServer(
      <CaseChecklist
        {...props([row({ wording: 'Valid passport, six months.', myWording: 'My passport' })])}
      />,
    );
    const text = textOf(html);
    expect(text).toContain('My passport');
    expect(text).toContain('Original: Valid passport, six months.');
    expect(text).toContain('Your Wording');
    expect(html).toContain('WordingEditor');
    // The correction suggestion keeps the official name.
    expect(html).toContain('data-suggest="Valid passport, six months."');
  });

  it('shows no tag and no original line for an item that is not reworded, but still offers editing', async () => {
    const html = await renderServer(<CaseChecklist {...props([row()])} />);
    const text = textOf(html);
    expect(text).not.toContain('Your Wording');
    expect(text).not.toContain('Original:');
    expect(html).toContain('WordingEditor');
  });

  it('offers no edit control when editing is off (case finished, or not switched on yet)', async () => {
    const html = await renderServer(
      <CaseChecklist {...props([row({ myWording: 'My passport' })], false)} />,
    );
    expect(html).not.toContain('WordingEditor');
    expect(textOf(html)).toContain('My passport');
  });

  it('keeps the status of a reworded required item exactly as it was', async () => {
    const html = await renderServer(
      <CaseChecklist {...props([row({ myWording: 'Optional, skip this' })])} />,
    );
    const text = textOf(html);
    expect(text).toContain('Optional, skip this');
    // The row still says it is mandatory, is still missing, and still asks for evidence.
    expect(text).toContain('Mandatory');
    expect(text).toContain('Missing');
    expect(text).toContain('Provide Evidence');
    expect(text).toContain('Needs You');
  });
});
