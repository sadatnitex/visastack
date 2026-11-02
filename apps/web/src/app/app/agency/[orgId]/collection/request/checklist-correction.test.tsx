import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { textOf } from '../../../../../../lib/next-mocks.test-support';

/** UMPE P11: the agency request's Official Checklist Updates card. Made-up checklists only. */

vi.mock('./checklist-correction-actions', () => ({
  suggestAgencyCorrectionAction: vi.fn(),
}));

const { ChecklistCorrectionCard } = await import('./checklist-correction');

const impact = {
  packName: 'Synthetic GB Visit',
  pinnedVersion: 1,
  newerVersion: 2,
  newerPackVersionId: 'v2',
  item: { changeKind: 'ADDED', itemKind: 'DOCUMENT', itemKey: 'NID', changedCount: 2 },
  itemName: 'National ID Card',
  draftPinned: true,
  issuedPinned: true,
} as const;

const render = (props: Partial<Parameters<typeof ChecklistCorrectionCard>[0]> = {}) =>
  renderToStaticMarkup(
    <ChecklistCorrectionCard
      organizationId="o1"
      requestId="q1"
      impact={impact}
      open
      officialItems={[{ value: 'r1', label: 'Passport' }]}
      {...props}
    />,
  );

describe('Official Checklist Updates on an agency request', () => {
  it('names the newer version and its one precise item, and keeps issued revisions as issued', () => {
    const text = textOf(render());
    expect(text).toContain('A newer version of Synthetic GB Visit was published (Version 2).');
    expect(text).toContain('This request follows Version 1.');
    expect(text).toContain('National ID Card was added, and 1 other change.');
    expect(text).toContain('What you already issued stays exactly as it was.');
  });

  it('claims the newest version only when that was actually checked on an open request', () => {
    expect(textOf(render({ impact: null }))).toContain(
      'This request follows the newest published official checklist.',
    );
    expect(textOf(render({ impact: undefined }))).not.toContain('newest published');
    expect(textOf(render({ impact: null, open: false }))).not.toContain('newest published');
  });

  it('offers the official items to suggest a correction on, and the whole checklist', () => {
    const html = render();
    expect(html).toContain('value="r1"');
    expect(textOf(html)).toContain('Something Missing from the Checklist');
    expect(textOf(html)).toContain('Send Suggestion');
  });
});
