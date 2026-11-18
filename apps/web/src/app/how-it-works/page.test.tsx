import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../lib/next-mocks.test-support';

/**
 * R2: the How It Works page rebuilt to the approved reference. Four chapters in a fixed order, the
 * old case story left out, every made-up figure tagged Example, readiness never an approval. The
 * page is read as a parsed document, as a visitor with no script (or reduced motion) gets it.
 */

vi.mock('server-only', () => ({}));

const { default: HowItWorksPage, metadata } = await import('./page');
const render = async () => new JSDOM(await renderServer(await HowItWorksPage())).window.document;
/** The words of a node, each text piece separated by a space (jsdom has no innerText). */
function words(node: Element | Document): string {
  const root = 'body' in node ? node.body : node;
  const pieces: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const piece = (next.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (piece) pieces.push(piece);
  }
  return pieces.join(' ');
}
const chapters = (doc: Document) => [...doc.querySelectorAll('section[data-tone]')];

describe('the How It Works page (R2)', () => {
  it('is named How It Works and has one top heading', async () => {
    expect(metadata.title).toBe('How It Works');
    const doc = await render();
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(words(doc.querySelector('h1') as Element)).toContain('How It Works.');
  });

  it('opens with the four numbered steps in order', async () => {
    const doc = await render();
    const first = chapters(doc)[0] as Element;
    const chips = [...first.querySelectorAll('ol > li')].map((li) => words(li).trim());
    expect(chips).toEqual(['1 Add', '2 Check', '3 Prepare', '4 Share']);
  });

  it('runs four chapters: dark opening, light rows, light words band, dark closing', async () => {
    const doc = await render();
    expect(chapters(doc).map((chapter) => chapter.getAttribute('data-tone'))).toEqual([
      'dark',
      'light',
      'light',
      'dark',
    ]);
  });

  it('draws one row per step, each with the picture that step needs', async () => {
    const doc = await render();
    const rows = [...doc.querySelectorAll('.hk-row')];
    expect(rows.map((row) => row.querySelector('h2')?.textContent)).toEqual([
      'Add',
      'Check',
      'Prepare',
      'Share',
    ]);
    const art = rows.map((row) => row.querySelector('figure'));
    expect(art.map((figure) => figure?.getAttribute('aria-label'))).toEqual([
      'Example of a document being read on a phone',
      'Example of a document being read on a phone',
      'Example of a country checklist',
      'Example of sharing papers with an agency',
    ]);
    expect(art[0]?.getAttribute('data-kit-step')).toBe('1');
    expect(art[1]?.getAttribute('data-kit-step')).toBe('2');
    expect(art[0]?.querySelectorAll('.pub-chip-suggested').length).toBeGreaterThan(0);
    expect(art[1]?.querySelectorAll('.pub-chip-confirmed').length).toBeGreaterThan(0);
    expect(words(art[2] as Element)).toContain('Germany: 3 of 8 Ready');
    expect(words(art[3] as Element)).toContain('Turn Off');
    // Sharing cannot be limited to part of a document today (packages/services/src/sharing.ts): no
    // part, page or size is promised on the sheet.
    const sheet = words(art[3] as Element);
    expect(sheet.match(/See Document Details/g)).toHaveLength(2);
    expect(sheet).toContain('Passport, details');
    expect(sheet).toContain('Photo, details');
    expect(sheet).not.toMatch(/photo page|visa size/i);
  });

  it('removes the old case story chapters', async () => {
    const text = words(await render());
    for (const gone of [
      'Your Case,',
      'Step by Step',
      'You Stay in Charge',
      'Ready When You Are',
      'Follow a Case',
    ]) {
      expect(text, gone).not.toContain(gone);
    }
    expect((await render()).querySelectorAll('[data-scene]')).toHaveLength(0);
  });

  it('shows all four word tiles complete and unpressable without script or motion', async () => {
    const doc = await render();
    const tiles = [...doc.querySelectorAll('.hk-flip-grid > li')];
    expect(tiles.map((tile) => words(tile).trim())).toEqual([
      'Received is not Reviewed A file arrived. No one has checked it yet.',
      'Suggested is not Confirmed A detail was read from your page. Nothing is true until you say so.',
      'Saved is not Shared A saved file stays yours until you choose to share it.',
      'Ready is not Approved Ready counts what is complete. It never promises a visa.',
    ]);
    expect(doc.querySelectorAll('.hk-flip-grid button, .hk-flip-grid [aria-pressed]')).toHaveLength(
      0,
    );
  });

  it('tags every drawn figure as an Example and says readiness is not approval', async () => {
    const doc = await render();
    const figures = [...doc.querySelectorAll('figure')];
    expect(figures.length).toBeGreaterThanOrEqual(5);
    for (const figure of figures) {
      expect(
        figure.querySelector('.pub-example'),
        figure.getAttribute('aria-label') ?? '',
      ).not.toBeNull();
    }
    expect(words(doc)).toContain('Completeness only. Not an approval.');
  });

  it('keeps the start and privacy links where they were', async () => {
    const doc = await render();
    const link = (label: string) =>
      [...doc.querySelectorAll('a')].find((a) => words(a).trim() === label);
    expect(link('Start with Your Own Profile')?.getAttribute('href')).toBe('/app');
    expect(link('Privacy and Trust')?.getAttribute('href')).toBe('/trust');
  });

  it('closes with one heading named by the band', async () => {
    const doc = await render();
    const closing = chapters(doc)[3] as Element;
    const heading = closing.querySelector('h2') as Element;
    expect(closing.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(words(heading)).toContain('See It With Your Own Passport.');
    expect(closing.querySelectorAll('h2')).toHaveLength(1);
  });

  it('has no em dash', async () => {
    expect((await render()).documentElement.outerHTML).not.toContain(String.fromCharCode(0x2014));
  });
});
