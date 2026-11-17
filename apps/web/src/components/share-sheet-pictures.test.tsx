import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
import {
  SHARE_EXPLAIN_TEXT,
  SharePictureStrip,
  countDocumentKinds,
  sharePictureModel,
} from './share-sheet-pictures';
import type { DocumentScope, ProfileScope } from './selected-scope-summary';

const strip = (profile: ProfileScope, documents: DocumentScope) =>
  renderServer(<SharePictureStrip profile={profile} documents={documents} />);

/** The visible text of one strip row ("leaves" or "private"). */
function rowText(html: string, row: 'leaves' | 'private'): string {
  const start = html.indexOf(`<div class="share-pics-row share-pics-${row}"`);
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const end =
    row === 'leaves' ? rest.indexOf('<div class="share-pics-row share-pics-private"') : rest.length;
  return textOf(rest.slice(0, end));
}

describe('countDocumentKinds', () => {
  it('groups chosen documents by kind, in first-seen order, with counts', () => {
    expect(
      countDocumentKinds(['Passport', 'Bank Statement', 'Bank Statement', 'Notes from Rahim']),
    ).toEqual([
      { kind: 'docPassport', sample: 'Passport', count: 1 },
      { kind: 'docBank', sample: 'Bank Papers', count: 2 },
      { kind: 'file', sample: 'Document', count: 1 },
    ]);
  });
});

describe('SharePictureStrip', () => {
  it('draws each kind of chosen document with a count, never the document names', async () => {
    const html = await strip(
      { kind: 'nothing' },
      {
        kind: 'chosen',
        names: ['Passport', 'Bank Statement', 'Bank Statement', 'Notes from Rahim'],
        onlyInParts: false,
      },
    );
    const leaves = rowText(html, 'leaves');
    expect(leaves).toContain('Passport');
    expect(leaves).toContain('Bank Papers');
    expect(leaves).toContain('2 documents');
    expect(html).toContain('×2');
    expect(html).not.toContain('Rahim');
    expect(html).not.toContain('Bank Statement');
    expect(html.match(/data-picture=/g)?.length).toBe(3);
    expect(rowText(html, 'private')).toContain('Profile Details');
  });

  it('draws a whole profile and every document as leaving', async () => {
    const html = await strip({ kind: 'whole' }, { kind: 'every' });
    const leaves = rowText(html, 'leaves');
    expect(leaves).toContain('Whole Profile');
    expect(leaves).toContain('Every Document');
    expect(rowText(html, 'private')).toBe('Stays Private Everything Else');
  });

  it('draws chosen parts by their names and documents in those parts', async () => {
    const html = await strip(
      { kind: 'parts', labels: ['Identity', 'Education'] },
      { kind: 'inParts', when: 'now' },
    );
    const leaves = rowText(html, 'leaves');
    expect(leaves).toContain('Identity');
    expect(leaves).toContain('Education');
    expect(leaves).toContain('Documents in Chosen Parts');
  });

  it('draws documents the recipient cannot open as staying private', async () => {
    for (const documents of [
      { kind: 'every', notVisible: true },
      { kind: 'chosen', names: ['Passport'], onlyInParts: false, notVisible: true },
      { kind: 'nothing' },
    ] as const) {
      const html = await strip({ kind: 'whole' }, documents);
      expect(rowText(html, 'leaves')).not.toContain('Passport');
      expect(rowText(html, 'leaves')).not.toContain('Document');
      expect(html).not.toContain('data-picture=');
      expect(rowText(html, 'private')).toContain('Documents');
    }
  });

  it('says Nothing Yet when nothing leaves, as for a case grant', async () => {
    const html = await strip({ kind: 'case' }, { kind: 'omit' });
    expect(rowText(html, 'leaves')).toContain('Nothing Yet');
    expect(rowText(html, 'private')).toBe('Stays Private Everything Else');
    expect(sharePictureModel({ kind: 'case' }, { kind: 'omit' }).leaves).toEqual([]);
  });

  it('explains itself through a real button, says state in words, and embeds no files', async () => {
    const html = await strip({ kind: 'whole' }, { kind: 'every' });
    expect(html).toContain('class="explain-tip-trigger"');
    expect(textOf(html)).toContain('What They Get');
    expect(textOf(html)).toContain(SHARE_EXPLAIN_TEXT);
    expect(textOf(html)).toContain('They Get');
    expect(textOf(html)).toContain('Stays Private');
    expect(html).not.toMatch(/data:|blob:/);
    expect(html).not.toContain('—');
  });
});
