import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UX17: the chosen document must never be a small box with its own scroll. The block that undoes
 * the old caps (a 32 rem and a 22 rem box) and builds the phone full screen is the last word on
 * these rules, so a later rule that puts a cap back is caught here.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
const MARK = '/* WP-UMPE-UX17';
const block = css.slice(css.lastIndexOf(MARK));

describe('the chosen document is not a small box', () => {
  it('has the UX17 block, and nothing after it puts a height cap back on the panel', () => {
    expect(css.lastIndexOf(MARK)).toBeGreaterThan(-1);
    const after = block.slice(block.indexOf('*/') + 2);
    expect(/\.wallet-selected-document\s*\{[^}]*max-height:\s*[^n\s;]/.test(after)).toBe(false);
  });

  it('removes the cap on a tablet and phone, and makes the open panel a full screen', () => {
    expect(block).toMatch(
      /@media \(max-width: 1100px\)\s*\{\s*\.wallet-selected-document\s*\{[^}]*max-height:\s*none/,
    );
    expect(block).toMatch(
      /\.wallet-selected-document\[data-sheet="open"\]\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/,
    );
    expect(block).toMatch(
      /\.wallet-selected-document\[data-sheet="closed"\]\s*\{\s*display:\s*none/,
    );
  });

  it('shows the Add button and the way back on a phone only', () => {
    expect(block).toMatch(/\.wallet-sheet-bar\s*\{\s*display:\s*none/);
    expect(block).toMatch(/\.docs-add-fab\s*\{\s*display:\s*none/);
    expect(block).toMatch(/\.docs-add-fab\s*\{[^}]*position:\s*fixed/);
  });
});
