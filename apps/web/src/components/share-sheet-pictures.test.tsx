import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
import type { DocumentScope, ProfileScope } from './selected-scope-summary';
import { SHARE_EXPLAIN_TEXT, SharePictureStrip, sharePictureModel } from './share-sheet-pictures';

const strip = (
  profile: ProfileScope,
  documents: DocumentScope,
  tense: 'live' | 'notYet' = 'live',
) => renderServer(<SharePictureStrip profile={profile} documents={documents} tense={tense} />);

/** The visible text of one strip row ("leaves" or "private"), or null when the row is absent. */
function rowText(html: string, row: 'leaves' | 'private'): string | null {
  const start = html.indexOf(`<div class="share-pics-row share-pics-${row}"`);
  if (start === -1) return null;
  const rest = html.slice(start);
  const next = rest.indexOf('<div class="share-pics-row share-pics-private"');
  return textOf(row === 'leaves' && next > 0 ? rest.slice(0, next) : rest);
}

/** The drawing each picture in the strip shows, in order. */
const drawn = (html: string) => [...html.matchAll(/data-picture="([^"]+)"/g)].map((m) => m[1]);

describe('SharePictureStrip', () => {
  it('draws every chosen document as a plain Document with one count, never the names', async () => {
    const html = await strip(
      { kind: 'nothing' },
      {
        kind: 'chosen',
        names: ['Passport', 'Bank Statement', 'Bank Statement', 'Notes from Rahim'],
        onlyInParts: false,
      },
    );
    const leaves = rowText(html, 'leaves') ?? '';
    expect(leaves).toContain('Document');
    expect(leaves).toContain('4 documents');
    expect(html).toContain('\u00d74');
    expect(html).not.toContain('Rahim');
    expect(html).not.toContain('Bank');
    expect(html).not.toContain('Passport');
    // No guessed kinds: one plain paper picture for all of them.
    expect(drawn(html)).toEqual(['file']);
    expect(rowText(html, 'private')).toContain('Profile Details');
  });

  it('counts documents whose details failed to load, so the count never drops', async () => {
    const names = [
      'Document details unavailable',
      'Document details unavailable',
      'Document details unavailable',
    ];
    const html = await strip({ kind: 'nothing' }, { kind: 'chosen', names, onlyInParts: false });
    const leaves = rowText(html, 'leaves') ?? '';
    expect(leaves).not.toContain('Nothing Yet');
    expect(leaves).toContain('3 documents');
    expect(drawn(html)).toEqual(['file']);
  });

  it('counts a document the person named "Document details unavailable" like any other', async () => {
    const html = await strip(
      { kind: 'nothing' },
      {
        kind: 'chosen',
        names: ['Passport', 'Document details unavailable'],
        onlyInParts: false,
      },
    );
    expect(rowText(html, 'leaves')).toContain('2 documents');
  });

  it('says chosen documents open only inside chosen parts, as the access rules do', async () => {
    const html = await strip(
      { kind: 'nothing' },
      { kind: 'chosen', names: ['Bank Statement'], onlyInParts: true },
    );
    expect(rowText(html, 'leaves')).toContain('Only Those in Chosen Parts');
  });

  it('draws a whole profile and every document as leaving, with no private row to repeat', async () => {
    const html = await strip({ kind: 'whole' }, { kind: 'every' });
    const leaves = rowText(html, 'leaves') ?? '';
    expect(leaves).toContain('They Get');
    expect(leaves).toContain('Whole Profile');
    expect(leaves).toContain('Every Document');
    expect(rowText(html, 'private')).toBeNull();
  });

  it('reads as possible, not happening, while access is paused or not yet accepted', async () => {
    const html = await strip({ kind: 'whole' }, { kind: 'every' }, 'notYet');
    expect(rowText(html, 'leaves')).toContain('They Could Get');
  });

  it('draws chosen parts by their names and documents in those parts', async () => {
    const html = await strip(
      { kind: 'parts', labels: ['Identity', 'Education'] },
      { kind: 'inParts', when: 'now' },
    );
    const leaves = rowText(html, 'leaves') ?? '';
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
    expect(sharePictureModel({ kind: 'case' }, { kind: 'omit' }).leaves).toEqual([]);
  });

  it('explains itself through a real button, stays out of live regions, and embeds no files', async () => {
    const html = await strip({ kind: 'nothing' }, { kind: 'nothing' });
    expect(html).toContain('class="explain-tip-trigger"');
    expect(html).toContain('aria-live="off"');
    expect(textOf(html)).toContain('What They Get');
    expect(SHARE_EXPLAIN_TEXT).toBe(
      'Only what you see here is shared. You can stop sharing at any time; copies already downloaded stay with them.',
    );
    expect(textOf(html)).toContain(SHARE_EXPLAIN_TEXT);
    expect(textOf(html)).toContain('Stays Private');
    expect(html).not.toMatch(/data:|blob:/);
    expect(html).not.toContain(String.fromCodePoint(0x2014));
  });
});
