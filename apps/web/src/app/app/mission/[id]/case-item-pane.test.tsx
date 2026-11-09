import type { PackageItem } from '@visastack/services';
import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';
import type { RequirementDetailRow } from './case-model';

/** The panel a checklist row opens (synthetic values only). */

vi.mock('./package-actions', () => ({
  recordPackageChoiceAction: vi.fn(),
  markPackageChangeReviewedAction: vi.fn(),
  confirmPackageHandoffAction: vi.fn(),
}));
vi.mock('./wording-editor', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { WordingEditor: stub('WordingEditor') };
});
vi.mock('./readiness-gap-explain', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { ExplainGapButton: stub('ExplainGapButton') };
});
vi.mock('./suggest-correction', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { SuggestCorrection: stub('SuggestCorrection') };
});

const { CaseItemPane } = await import('./case-item-pane');

const ID = '30000000-0000-4000-8000-000000000001';

function row(over: Partial<RequirementDetailRow> = {}): RequirementDetailRow {
  return {
    packRequirementId: ID,
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

const copy = {
  kind: 'DOCUMENT' as const,
  documentId: 'd1',
  documentVersionId: '00000000-0000-4000-8000-0000000000a1',
  factId: null,
  factVersionId: null,
  displayName: 'Passport Scan',
  documentDate: '2026-10-01',
  usable: true,
  tooOld: false,
  conflicting: false,
};

const item: PackageItem = {
  packRequirementId: ID,
  kind: 'DOCUMENT',
  key: 'PASSPORT',
  citation: 'Synthetic rule',
  necessity: 'MANDATORY',
  provenance: 'OFFICIAL',
  groupKey: null,
  state: 'SATISFIED',
  blocking: true,
  proposed: copy,
  chosen: null,
  alternatives: [],
  newerCopy: null,
  canExclude: true,
};

function pane(
  over: Partial<Parameters<typeof CaseItemPane>[0]> = {},
  r: RequirementDetailRow = row(),
) {
  return renderServer(
    <CaseItemPane
      missionId="20000000-0000-4000-8000-000000000001"
      applicantId="10000000-0000-4000-8000-000000000001"
      row={r}
      rows={[r]}
      chosen={undefined}
      formatLines={undefined}
      packageItem={undefined}
      packageEditable={false}
      explanations={{ configured: false, off: undefined, byRequirement: new Map() }}
      wordingEditable={false}
      wordingMax={400}
      selfReviewed={true}
      {...over}
    />,
  );
}

describe('the item panel', () => {
  it('carries the full sentence, the chip word, and the two ways to provide a missing item', async () => {
    const html = await pane(
      {},
      row({
        wording: 'Passport valid for at least six months after you arrive, with two blank pages.',
      }),
    );
    const text = textOf(html);
    expect(text).toContain(
      'Passport valid for at least six months after you arrive, with two blank pages.',
    );
    expect(text).toContain('Missing');
    expect(text).toContain('Mandatory');
    expect(html).toContain('>Add</a>');
    expect(html).toContain('/documents/add');
    // The old link keeps its words and its address.
    expect(html).toMatch(/<a [^>]*href="#evidence"[^>]*>Provide Evidence<\/a>/);
  });

  it('sends a missing answer to the profile, not to the documents page', async () => {
    const html = await pane({}, row({ kind: 'FIELD', key: 'full_name' }));
    expect(html).toContain('/profile');
    expect(html).not.toContain('/documents/add');
  });

  it('asks for nothing on an item that is on file', async () => {
    const html = await pane({}, row({ state: 'SATISFIED' }));
    expect(textOf(html)).toContain('On File');
    expect(html).not.toContain('Provide Evidence');
    expect(html).not.toContain('>Add</a>');
  });

  it('says who added an item, by whether an agency can see the case', async () => {
    const added = row({ provenance: 'AGENCY_ADDED' });
    expect(textOf(await pane({ selfReviewed: true }, added))).toContain('Added by an Agency');
    expect(textOf(await pane({ selfReviewed: false }, added))).toContain(
      'Requested by Your Agency',
    );
    expect(
      textOf(await pane({}, row({ fromStarter: true, provenance: 'AGENCY_ADDED' }))),
    ).toContain('Starter List, Not Official');
  });

  it('shows a newer copy as a proposal and keeps the chosen one', async () => {
    const html = await pane({
      packageItem: {
        ...item,
        chosen: { choice: 'USE_COPY', copy, reason: null, chosenAt: '2026-11-01T00:00:00.000Z' },
        newerCopy: {
          ...copy,
          documentVersionId: '00000000-0000-4000-8000-0000000000a2',
          documentDate: '2026-10-20',
        },
      },
      packageEditable: true,
    });
    const text = textOf(html);
    expect(text).toContain('Using: Passport Scan (2026-10-01), chosen by you.');
    expect(text).toContain('A newer copy is available: Passport Scan (2026-10-20)');
    expect(html).toContain('package-choice-form');
  });

  it('shows the package choice only while the package can still change', async () => {
    const closed = await pane({ packageItem: item, packageEditable: false });
    expect(closed).not.toContain('<form');
    expect(textOf(closed)).toContain('Suggested: Passport Scan (2026-10-01).');
  });

  it('keeps the reason for leaving an item out in the page, and shown until the page script runs', async () => {
    const html = await pane({ packageItem: item, packageEditable: true });
    expect(html).toContain('class="package-reason"');
    expect(html).not.toMatch(/<div hidden="" class="package-reason">/);
    expect(html).toContain('name="reason"');
  });

  it('shows how a document must be provided when the checklist says', async () => {
    const text = textOf(
      await pane({ formatLines: ['Accepted As: Certified Copy', 'Translation Needed'] }),
    );
    expect(text).toContain('How to Provide It: Accepted As: Certified Copy · Translation Needed');
  });

  it('keeps the official name for a correction, whatever the traveller wrote', async () => {
    const html = await pane(
      { wordingEditable: true },
      row({ wording: 'Valid passport, six months.', myWording: 'My passport' }),
    );
    const text = textOf(html);
    expect(text).toContain('My passport');
    expect(text).toContain('Original: Valid passport, six months.');
    expect(html).toContain('WordingEditor');
  });
});
