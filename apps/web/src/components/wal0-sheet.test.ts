import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WAL0 guards. The browser specs in e2e/scroll-budget/WAL0.spec.ts measure the real thing; these
 * keep the three causes from coming back unnoticed: a view-transition name (a stacking context)
 * around an open phone sheet, an Add button drawn while a sheet is open, and a pill strip that
 * scrolls sideways.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
const page = readFileSync(
  resolve(__dirname, '../app/app/applicant/[id]/documents/page.tsx'),
  'utf8',
);

/** The text of every rule whose selector list mentions `selector`. */
function rulesFor(selector: string): string[] {
  const found: string[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(pattern)) {
    if ((match[1] ?? '').includes(selector)) found.push(match[2] ?? '');
  }
  return found;
}

describe('WAL0 the open document sheet is never covered', () => {
  it('gives the list a view-transition name only above 760 px, where there is no full-screen sheet', () => {
    const at = css.indexOf('view-transition-name: wallet-view');
    expect(at).toBeGreaterThan(-1);
    expect(css.split('view-transition-name: wallet-view').length).toBe(2);
    const before = css.slice(Math.max(0, at - 700), at);
    expect(before).toContain('@media (min-width: 761px)');
    expect(before).toContain('prefers-reduced-motion: no-preference');
  });

  it('hides the Add button and its spacer on a phone while a sheet is open', () => {
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{\s*body:has\(\.wallet-selected-document\[data-sheet="open"\]\) \.docs-add-fab,\s*body:has\(\.wallet-selected-document\[data-sheet="open"\]\) \.docs-add-fab-space \{\s*display: none;/,
    );
  });

  it('keeps the sheet clear of the bottom bar and the phone bottom edge', () => {
    expect(css).toMatch(
      /\.wallet-selected-document\[data-sheet="open"\] \{\s*padding-bottom: calc\(61px \+ env\(safe-area-inset-bottom, 0px\) \+ var\(--space-4\)\);/,
    );
  });

  it('keeps the Add button in the page, so it is back when the sheet is closed on the phone', () => {
    expect(page).toMatch(/<div className="docs-add-fab-space"/);
    expect(page).not.toMatch(/selection \? null : \(\s*<>\s*<div className="docs-add-fab-space"/);
    expect(page.split('className="docs-add-fab"').length).toBe(2);
  });
});

describe('WAL0 the case section links never scroll sideways', () => {
  it('has no rule that makes the strip a single scrolling row', () => {
    const rules = rulesFor('.jump-nav').join('\n');
    expect(rules).not.toMatch(/flex-wrap:\s*nowrap/);
    expect(rules).not.toMatch(/overflow-x:\s*auto/);
    expect(rules).toMatch(/flex-wrap:\s*wrap/);
  });

  it('folds the links behind one Jump to Section row below 761 px, and draws the pills from 761 px', () => {
    expect(css).toMatch(/\.jump-select \{\s*display: none;/);
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{\s*\.lift-case \.jump-nav \.jump-links \{\s*display: none;/,
    );
    expect(css).toMatch(/\.lift-case \.jump-nav \.jump-select-list a \{[^}]*min-height: 44px;/);
    expect(css).not.toMatch(/\.jump-select-list \{[^}]*position: absolute/);
  });

  it('draws the fold from the same links as the pills, in one native details element', () => {
    const casePage = readFileSync(resolve(__dirname, '../app/app/mission/[id]/page.tsx'), 'utf8');
    expect(casePage).toMatch(
      /<details className="jump-select">\s*<summary>Jump to Section<\/summary>/,
    );
    expect(casePage).toMatch(/<div className="jump-select-list">\{jumpLinks\}<\/div>/);
    expect(casePage).toMatch(/<div className="jump-links">\{jumpLinks\}<\/div>/);
  });
});

describe('WAL0 the case page stays inside the screen', () => {
  it('lets a task title with no break points shrink instead of widening the page', () => {
    const task = rulesFor('.task-row .row-key').join('\n');
    expect(task).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('opens the More panel inside the screen on a phone, whichever side its button is on', () => {
    expect(css).toMatch(
      /@media \(min-width: 641px\) and \(max-width: 760px\) \{\s*\.case-more \{\s*position: static;\s*\}\s*\.case-more-panel \{\s*top: auto;\s*right: var\(--space-4\);\s*left: var\(--space-4\);/,
    );
  });

  it('keeps the depth switch inside a 320 px screen', () => {
    expect(css).toMatch(
      /@media \(max-width: 22rem\) \{\s*\.depth-seg \{\s*padding-inline: var\(--space-3\);/,
    );
  });
});

describe('WAL0 the fixture keeps the case page section links', () => {
  /** Every link in the page's `jumpLinks` block: address, label and level token, in order. */
  function pageLinks(): readonly string[] {
    const source = readFileSync(resolve(__dirname, '../app/app/mission/[id]/page.tsx'), 'utf8');
    const start = source.indexOf('const jumpLinks = (');
    const block = source.slice(start, source.indexOf('\n  );', start));
    return [...block.matchAll(/<a href="(#[a-z-]+)"([^>]*)>\s*([^<]+?)\s*<\/a>/g)].map((m) => {
      const level = /atLevel\((?:'(\w+)'|(notesLevel))\)/.exec(m[2] ?? '');
      // The page's notesLevel is Browse, or Everything on a reviewed case with no notes; the
      // fixture draws the usual Browse.
      const token = level ? (level[1] ?? 'browse') : 'none';
      return `${m[1]} | ${m[3]} | ${token}`;
    });
  }

  function fixtureLinks(): readonly string[] {
    const source = readFileSync(
      resolve(__dirname, '../../e2e/scroll-budget/WAL0.fixture.tsx'),
      'utf8',
    );
    const start = source.indexOf('const LINKS');
    const block = source.slice(start, source.indexOf('\n];', start));
    return [...block.matchAll(/\['(#[a-z-]+)', '([^']+)', (?:'(\w+)'|null)\]/g)].map(
      (m) => `${m[1]} | ${m[2]} | ${m[3] ?? 'none'}`,
    );
  }

  it('lists the same addresses, labels and levels, in the same order, as the page', () => {
    const fromPage = pageLinks();
    expect(fromPage.length).toBeGreaterThan(5);
    expect(fixtureLinks()).toEqual(fromPage);
  });
});
