import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentWalletBrowser } from '../document-wallet-browser';
import { DocumentHeroCard } from './document-hero-card';

/**
 * WAL2: the front of the opened document (owner decision 17 Nov 2026, Preview Card First with the
 * Wallet Pass front as the hero). Presentation only: names, states and buttons come from the page.
 */

const hero = (extra: Partial<Parameters<typeof DocumentHeroCard>[0]> = {}) =>
  renderToStaticMarkup(
    <DocumentHeroCard
      nameId="doc-name-d1"
      name="Passport - Example.pdf"
      kind="Passport"
      docType="PASSPORT"
      facts={['Updated 4 Nov 2026']}
      marks={[
        {
          id: 'safety',
          label: 'File Type Checked',
          explain: 'We checked the file type.',
          tone: 'ok',
        },
        {
          id: 'expiry',
          label: 'Expiry Not Confirmed',
          explain: 'No expiry date is confirmed for this document yet.',
          tone: 'neutral',
        },
      ]}
      actions={<button type="submit">Preview</button>}
      {...extra}
    />,
  );

describe('the document hero card', () => {
  it('names the file, its kind and when it changed, with the name as the heading others point at', () => {
    const html = hero();
    expect(html).toMatch(
      /<h3 class="doc-hero-name" id="doc-name-d1"[^>]*>Passport - Example.pdf<\/h3>/,
    );
    expect(html).toContain('>Passport</p>');
    expect(html).toContain('Updated 4 Nov 2026');
    expect(html).toContain('aria-labelledby="doc-name-d1"');
  });

  it('wears the dark pass look from the picture stylesheet, never inline styles', () => {
    const html = hero();
    expect(html).toMatch(/class="doc-hero pic-pass"/);
    expect(html).not.toContain('style=');
    const source = readFileSync(
      fileURLToPath(new URL('./document-hero-card.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/style=\{\{/);
  });

  it('draws the kind of document when there is no preview, so the card is never empty', () => {
    expect(hero()).toMatch(
      /class="doc-hero-art pic-glow"><(span|div|figure|svg)[^>]*class="[^"]*pic/,
    );
    const withPreview = hero({ preview: <span className="real-preview">preview</span> });
    expect(withPreview).toContain('real-preview');
  });

  it('shows each state as a small picture with an Explain note and its word beside it', () => {
    const html = hero();
    const marks = html.match(/<li class="doc-hero-mark"[\s\S]*?<\/li>/g) ?? [];
    expect(marks).toHaveLength(2);
    for (const [mark, word, sentence] of [
      [marks[0], 'File Type Checked', 'We checked the file type.'],
      [marks[1], 'Expiry Not Confirmed', 'No expiry date is confirmed for this document yet.'],
    ] as const) {
      expect(mark).toContain('class="explain-tip-trigger"');
      expect(mark).toContain(`<span class="sr-only">${word}</span>`);
      expect(mark).toContain(sentence);
      expect(mark).toMatch(new RegExp(`class="doc-hero-mark-word"[^>]*>${word}</span>`));
    }
  });

  it('announces a live state politely and keeps the repeated word away from screen readers otherwise', () => {
    const html = hero({
      marks: [
        { id: 'p', label: 'Ready', explain: 'How far our checks got.', tone: 'ok', live: true },
        { id: 's', label: 'Current', explain: 'In date.', tone: 'ok' },
      ],
    });
    expect(html).toMatch(/class="doc-hero-mark-word" aria-hidden="true">Ready</);
    expect(html).toMatch(/class="sr-only" aria-live="polite">Ready</);
    expect(html).toMatch(/class="doc-hero-mark-word" aria-hidden="true">Current</);
  });

  it('carries the page buttons as they are, and leaves the actions row out when there are none', () => {
    expect(hero()).toContain(
      '<div class="doc-hero-actions"><button type="submit">Preview</button>',
    );
    expect(hero({ actions: null })).not.toContain('doc-hero-actions');
  });
});

describe('the opened document with a hero', () => {
  const base = {
    id: 'd1',
    name: 'Passport - Example.pdf',
    kind: 'Passport',
    category: 'Identity',
    version: 1,
    updatedAt: null,
    ready: true,
    needsReview: false,
    expiring: false,
    safetyLabel: 'File Type Checked',
    processingLabel: 'Ready',
    details: <p>details</p>,
  };

  it('puts the hero where the plain name box was', () => {
    const html = renderToStaticMarkup(
      <DocumentWalletBrowser
        applicantId="a1"
        initialSelection="d1"
        documents={[{ ...base, previewAllowed: true, hero: <div className="the-hero">hero</div> }]}
      />,
    );
    expect(html).toContain('the-hero');
    expect(html).not.toContain('document-preview-placeholder');
  });

  it('still says a blocked preview is blocked when a hero is shown', () => {
    const html = renderToStaticMarkup(
      <DocumentWalletBrowser
        applicantId="a1"
        initialSelection="d1"
        documents={[{ ...base, previewAllowed: false, hero: <div className="the-hero">hero</div> }]}
      />,
    );
    expect(html).toContain('Preview is blocked');
  });

  it('keeps the plain name box for a page that gives no hero', () => {
    const html = renderToStaticMarkup(
      <DocumentWalletBrowser
        applicantId="a1"
        initialSelection="d1"
        documents={[{ ...base, previewAllowed: true }]}
      />,
    );
    expect(html).toContain('document-preview-placeholder');
  });
});
