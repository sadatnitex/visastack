import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
import {
  SelectedScopeSummary,
  type SelectedScopeSummaryProps,
  describeGrantScope,
} from './selected-scope-summary';

const NARROW: SelectedScopeSummaryProps = {
  recipient: 'agent@example.com',
  purpose: 'UK student visa review',
  permissions: ['see document details', 'preview documents'],
  profile: { kind: 'parts', labels: ['Identity', 'Education'] },
  documents: { kind: 'inParts', when: 'now' },
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

const scope = (overrides: Partial<Parameters<typeof describeGrantScope>[0]> = {}) =>
  describeGrantScope({
    actions: ['VIEW_METADATA', 'PREVIEW'],
    caseGrant: false,
    partLabels: [],
    documentNames: [],
    hasDocuments: true,
    partsWhen: 'now',
    ...overrides,
  });

describe('SelectedScopeSummary (WP-X2)', () => {
  it('shows recipient, purpose, permissions and scopes exactly as given', async () => {
    const html = await render(NARROW);
    expect(row(html, 'Who')?.text).toBe('agent@example.com');
    expect(row(html, 'For')?.text).toBe('UK student visa review');
    expect(row(html, 'They can')?.text).toBe('see document details, preview documents');
    expect(row(html, 'Can see')?.text).toBe('Identity, Education');
    expect(row(html, 'Can open')?.text).toBe('documents in the parts you chose');
    expect(row(html, 'Ends on')?.text).toBe('24 Nov 2026 (in 30 days, the default)');
    expect(textOf(html)).toContain('Everything you did not select stays private.');
  });

  it('uses warning tone only for the whole profile, every document and no end date', async () => {
    const narrow = await render(NARROW);
    for (const term of ['Can see', 'Can open', 'Ends on']) {
      expect(row(narrow, term)?.warning).toBe(false);
    }
    const broad = await render({ ...NARROW, ...scope(), endsOn: null });
    expect(row(broad, 'Can see')).toEqual({ text: 'your whole profile', warning: true });
    expect(row(broad, 'Can open')).toEqual({ text: 'every document', warning: true });
    expect(row(broad, 'Ends on')).toEqual({ text: 'no end date', warning: true });
  });

  it('reads ended access in the past tense, without warning tone or the privacy line', async () => {
    const html = await render({ ...NARROW, ...scope(), tense: 'ended' });
    expect(row(html, 'They could')).toBeDefined();
    expect(row(html, 'Could see')).toEqual({ text: 'your whole profile', warning: false });
    expect(row(html, 'Ended')?.text).toBe('24 Nov 2026 (in 30 days, the default)');
    expect(row(html, 'They can')).toBeUndefined();
    expect(textOf(html)).not.toContain('stays private');
    const paused = await render({ ...NARROW, tense: 'notYet' });
    expect(row(paused, 'They could')).toBeDefined();
    expect(row(paused, 'Ends on')).toBeDefined();
  });

  it('leaves out the recipient and purpose when not given', async () => {
    const html = await render({ ...NARROW, recipient: undefined, purpose: null } as never);
    expect(row(html, 'Who')).toBeUndefined();
    expect(row(html, 'For')).toBeUndefined();
  });
});

describe('describeGrantScope follows the access rules', () => {
  it('specific documents give no profile details, and only those documents open', () => {
    expect(scope({ documentNames: ['Passport summary'] })).toEqual({
      profile: { kind: 'nothing' },
      documents: {
        kind: 'chosen',
        names: ['Passport summary'],
        onlyInParts: false,
        detailsOnly: false,
      },
    });
  });

  it('with both parts and documents chosen, says only chosen documents in those parts open', () => {
    expect(scope({ partLabels: ['Identity'], documentNames: ['Payslip'] }).documents).toEqual({
      kind: 'chosen',
      names: ['Payslip'],
      onlyInParts: true,
      detailsOnly: false,
    });
  });

  it('needs see document details for profile details, and preview or download to open documents', () => {
    expect(scope({ actions: ['PREVIEW'] }).profile).toEqual({ kind: 'nothing' });
    expect(scope({ actions: ['COMMENT'] }).documents).toEqual({ kind: 'nothing' });
    expect(scope({ actions: ['VIEW_METADATA', 'COMMENT'] }).documents).toEqual({
      kind: 'every',
      detailsOnly: true,
    });
    expect(scope({ actions: ['VIEW_METADATA', 'DOWNLOAD_REDACTED'] }).documents).toEqual({
      kind: 'every',
      detailsOnly: false,
    });
  });

  it('a case grant shows one case and no documents row; parts on a card are as at sharing', () => {
    expect(scope({ caseGrant: true })).toEqual({
      profile: { kind: 'case' },
      documents: { kind: 'omit' },
    });
    expect(scope({ partLabels: ['Identity'], partsWhen: 'atSharing' }).documents).toEqual({
      kind: 'inParts',
      when: 'atSharing',
      detailsOnly: false,
    });
    expect(scope({ hasDocuments: false }).documents).toEqual({ kind: 'omit' });
  });

  it('with details only, names the documents and says they cannot be opened', async () => {
    const html = await render({
      ...NARROW,
      ...scope({ actions: ['VIEW_METADATA'], documentNames: ['Passport summary'] }),
    });
    expect(row(html, 'Document details')?.text).toBe(
      'Passport summary Details only. They cannot open these.',
    );
    expect(row(html, 'Can open')).toBeUndefined();
  });
});
