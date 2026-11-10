import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The one list pattern's look (case page plan, section 8): every row at least 56px tall on every
 * width with 44px targets, the panel a full screen on a narrow screen, nothing but flat surfaces.
 * Read from the stylesheet, so a later rule that shrinks a row or adds a shadow is caught here.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
const START = css.lastIndexOf('/* WP-LP1 ');
const END = css.indexOf('/* end WP-LP1 */', START);
const block = css.slice(START, END);

describe('the list pattern block', () => {
  it('is one whole block of the stylesheet', () => {
    expect(START).toBeGreaterThan(-1);
    expect(END).toBeGreaterThan(START);
    expect(css.match(/\/\* WP-LP1 /g)).toHaveLength(1);
  });

  it('keeps every row at least 56px tall, with a 44px target for the name', () => {
    expect(block).toMatch(/\.lift-check\.lp-row\s*\{[^}]*min-height:\s*56px/);
    expect(block).toMatch(/\.lp-row-open\s*\{[^}]*min-height:\s*44px/);
    // No later rule shortens a row.
    const after = css.slice(END);
    expect(/\.lp-row\s*\{[^}]*(?:min-)?height:\s*\d/.test(after)).toBe(false);
  });

  it('keeps a row to one line of name, cut with an ellipsis', () => {
    expect(block).toMatch(/\.lp-row-name\s*\{[^}]*white-space:\s*nowrap/);
    expect(block).toMatch(/\.lp-row-name\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('makes the open panel a full screen on a narrow screen, with a way back', () => {
    expect(block).toMatch(
      /@media \(max-width: 1180px\)\s*\{\s*\.lp-pane\[data-sheet="open"\]\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/,
    );
    // The way back is drawn on every width, a 44px bar on a wide screen and a 56px one on top of the full screen.
    expect(block).toMatch(/\.lp-pane-bar\s*\{\s*display:\s*flex[^}]*min-height:\s*44px/);
    expect(block).toMatch(/\.lp-pane-bar\s*\{[^}]*min-height:\s*56px/);
  });

  it('puts the panel in the side column on a wide screen, 384px wide, and steps the rail aside', () => {
    expect(block).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 24rem/);
    expect(block).toMatch(/> \.split-rail\s*\{\s*display:\s*none/);
  });

  it('is flat: no shadow, gradient, glass or translucent surface', () => {
    expect(block).not.toMatch(/box-shadow|text-shadow|gradient|backdrop-filter|filter:|rgba\(/);
  });

  it('draws the hidden panels and the hidden reason box as nothing', () => {
    expect(block).toMatch(/\.lp-pane-item\[hidden\]\s*\{\s*display:\s*none/);
    expect(block).toMatch(/\.package-reason\[hidden\]\s*\{\s*display:\s*none/);
  });
});

describe('the list pattern second block (WP-LP2)', () => {
  const start = css.lastIndexOf('/* WP-LP2 ');
  const block2 = css.slice(start, css.indexOf('/* end WP-LP2 */', start));

  it('is one whole block', () => {
    expect(start).toBeGreaterThan(-1);
    expect(css.match(/\/\* WP-LP2 /g)).toHaveLength(1);
  });

  it('keeps the search under the page header, flat', () => {
    expect(block2).toMatch(/\.lp-sticky-filter\s*\{[^}]*position:\s*sticky/);
    expect(block2).toMatch(/\.lp-sticky-filter\s*\{[^}]*background:\s*var\(--bg-elevated\)/);
  });

  it('makes every section tab a 44px target that scrolls inside its own row on a narrow screen', () => {
    expect(block2).toMatch(/\.sw-tab\s*\{[^}]*min-height:\s*44px/);
    expect(block2).toMatch(/\.sw-tabs\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('draws a hidden tab row, panel, folder or row as nothing', () => {
    expect(block2).toMatch(/\.sw-tabs\[hidden\]\s*\{\s*display:\s*none/);
    expect(block2).toMatch(/\.sw-panel\[hidden\]\s*\{\s*display:\s*none/);
  });

  it('is flat', () => {
    expect(block2).not.toMatch(/box-shadow|text-shadow|gradient|backdrop-filter|rgba\(/);
  });
});
