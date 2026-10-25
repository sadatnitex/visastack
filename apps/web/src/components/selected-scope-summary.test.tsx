import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
import { SelectedScopeSummary, type SelectedScopeSummaryProps } from './selected-scope-summary';

const NARROW: SelectedScopeSummaryProps = {
  recipient: 'agent@example.com',
  purpose: 'UK student visa review',
  permissions: ['see document details', 'preview documents'],
  profile: { kind: 'parts', labels: ['Identity', 'Education'] },
  documents: { kind: 'chosen', names: ['Passport summary'] },
  endsOn: '24 Nov 2026',
  endsNote: 'in 30 days, the default',
};

const render = (props: SelectedScopeSummaryProps) =>
  renderServer(<SelectedScopeSummary {...props} />);

/** The text of the row whose label is `term`, and whether it is in warning tone. */
function row(html: string, term: string): { text: string; warning: boolean } | undefined {
  const match = [
    ...html.matchAll(/<div class="(scope-row[^"]*)"><dt>([^<]*)<\/dt><dd>(.*?)<\/dd><\/div>/g),
  ].find((m) => m[2] === term);
  return match
    ? { text: textOf(match[3] ?? ''), warning: (match[1] ?? '').includes('warning') }
    : undefined;
}

describe('SelectedScopeSummary (WP-X2)', () => {
  it('shows recipient, purpose, permissions and scopes exactly as given', async () => {
    const html = await render(NARROW);
    expect(row(html, 'Who')?.text).toBe('agent@example.com');
    expect(row(html, 'For')?.text).toBe('UK student visa review');
    expect(row(html, 'They can')?.text).toBe('see document details, preview documents');
    expect(row(html, 'Can see')?.text).toBe('Identity, Education');
    expect(row(html, 'Can open')?.text).toBe('Passport summary');
    expect(row(html, 'Ends on')?.text).toBe('24 Nov 2026 (in 30 days, the default)');
    expect(textOf(html)).toContain('Everything you did not select stays private.');
  });

  it('uses warning tone only for the whole profile, every document and no end date', async () => {
    const narrow = await render(NARROW);
    for (const term of ['Can see', 'Can open', 'Ends on'])
      expect(row(narrow, term)?.warning).toBe(false);
    const broad = await render({
      ...NARROW,
      profile: { kind: 'whole' },
      documents: { kind: 'every' },
      endsOn: null,
    });
    expect(row(broad, 'Can see')).toEqual({ text: 'your whole profile', warning: true });
    expect(row(broad, 'Can open')).toEqual({ text: 'every document', warning: true });
    expect(row(broad, 'Ends on')).toEqual({ text: 'No end date', warning: true });
  });

  it('names a case grant and documents within chosen parts, and leaves out rows with nothing to say', async () => {
    const html = await render({
      ...NARROW,
      purpose: null,
      profile: { kind: 'case' },
      documents: { kind: 'none' },
    });
    expect(row(html, 'For')).toBeUndefined();
    expect(row(html, 'Can open')).toBeUndefined();
    expect(row(html, 'Can see')?.text).toBe('one specific case');
    const parts = await render({ ...NARROW, documents: { kind: 'everyInParts' } });
    expect(row(parts, 'Can open')).toEqual({
      text: 'every document in the parts you chose',
      warning: false,
    });
  });
});
