import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../../../lib/next-mocks.test-support';
import type { RequirementDetailRow } from './case-model';

/** The checklist rows wear the picture of their kind (owner decision, 10 Nov 2026; synthetic values). */

vi.mock('./wording-editor', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { WordingEditor: stub('WordingEditor') };
});
vi.mock('./readiness-gap-explain', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { ExplainGapButton: stub('ExplainGapButton') };
});
vi.mock('./suggest-correction', () => ({ SuggestCorrection: () => null }));

const { CaseChecklist } = await import('./case-checklist');

function row(over: Partial<RequirementDetailRow>): RequirementDetailRow {
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

describe('checklist rows', () => {
  it('draws every row with the picture of its kind and a status chip with its own symbol', async () => {
    const html = await renderServer(
      <CaseChecklist
        applicantId="10000000-0000-4000-8000-000000000001"
        packName="Synthetic Checklist"
        itemHref={(id) => `?item=${id}`}
        rows={[
          row({ packRequirementId: '30000000-0000-4000-8000-000000000001', key: 'PASSPORT' }),
          row({
            packRequirementId: '30000000-0000-4000-8000-000000000002',
            key: 'BANK_STATEMENT',
            state: 'SATISFIED',
          }),
          row({
            packRequirementId: '30000000-0000-4000-8000-000000000003',
            kind: 'FIELD',
            key: 'given_name',
            state: 'UNVERIFIED',
          }),
        ]}
      />,
    );
    const rows = html.match(/data-pattern="list-row"/g) ?? [];
    expect(rows).toHaveLength(3);
    expect(html.match(/class="mark-tile lift-check-mark"/g)).toHaveLength(3);
    expect(html).toContain('data-mark="docPassport"');
    expect(html).toContain('data-mark="docBank"');
    expect(html).toContain('data-mark="user"');
    // Missing needs you, On File is done, To Confirm needs a check.
    expect(html.match(/lift-pill-icon/g)).toHaveLength(3);
  });
});
