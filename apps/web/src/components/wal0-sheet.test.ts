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
  it('gives the list a view-transition name only above 760 px and never while a sheet is open', () => {
    const at = css.indexOf('view-transition-name: wallet-view');
    expect(at).toBeGreaterThan(-1);
    expect(css.split('view-transition-name: wallet-view').length).toBe(2);
    const before = css.slice(Math.max(0, at - 400), at);
    expect(before).toContain('@media (min-width: 761px)');
    expect(before).toContain(':not(:has(.wallet-selected-document[data-sheet="open"]))');
    expect(before).toContain('prefers-reduced-motion: no-preference');
  });

  it('hides the Add button and its spacer on a phone while a sheet is open', () => {
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{\s*body:has\(\.wallet-selected-document\[data-sheet="open"\]\) \.docs-add-fab,\s*body:has\(\.wallet-selected-document\[data-sheet="open"\]\) \.docs-add-fab-space \{\s*display: none;/,
    );
  });

  it('keeps the sheet clear of the bottom bar and the phone bottom edge', () => {
    expect(css).toMatch(
      /\.wallet-selected-document\[data-sheet="open"\] \{\s*padding-bottom: calc\(var\(--space-6\) \+ 5rem \+ env\(safe-area-inset-bottom, 0px\)\);/,
    );
  });

  it('leaves the Add button out of the page when the address names a document', () => {
    expect(page).toMatch(/\{selection \? null : \(\s*<>\s*<div className="docs-add-fab-space"/);
    expect(page.split('className="docs-add-fab"').length).toBe(2);
  });
});

describe('WAL0 the case pill strip wraps and never scrolls sideways', () => {
  it('has no rule that makes the strip a single scrolling row', () => {
    const rules = rulesFor('.jump-nav').join('\n');
    expect(rules).not.toMatch(/flex-wrap:\s*nowrap/);
    expect(rules).not.toMatch(/overflow-x:\s*auto/);
    expect(rules).toMatch(/flex-wrap:\s*wrap/);
  });
});
