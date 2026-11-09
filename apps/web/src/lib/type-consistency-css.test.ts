import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The same kind of thing is drawn at the same size on the case page (owner, 9 Nov 2026): a folder
 * header is smaller than a row's name, every small blue fold link shares one size, and the header
 * badge matches the line beside it. Read from the stylesheet, so a later rule that breaks one is
 * caught here.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
const START = css.lastIndexOf('/* WP-TS1 ');
/** The font size the LAST rule for a selector gives (the one that wins when specificity ties). */
function lastSize(selector: string): string | null {
  const own = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${own}\\s*\\{([^}]*)\\}`, 'g'))];
  for (let i = rules.length - 1; i >= 0; i -= 1) {
    const size = (rules[i]?.[1] ?? '').match(/font-size:\s*([^;]+);/)?.[1];
    if (size) return size.trim();
  }
  return null;
}
const block = css.slice(START, css.indexOf('/* end WP-TS1 */', START));

describe('type on the case page is consistent', () => {
  it('has its own whole block', () => {
    expect(START).toBeGreaterThan(-1);
    expect(css.match(/\/\* WP-TS1 /g)).toHaveLength(1);
  });

  it('makes a folder header smaller than a row name (14px against 16px)', () => {
    expect(block).toMatch(/\.lift-group \.case-group-heading\s*\{[^}]*font-size:\s*0\.875rem/);
    expect(lastSize('.row-key')).toBe('var(--text-body)');
    expect(css).toMatch(/--text-body:\s*1rem;/);
  });

  it('gives About This Case the same size and left edge as the other fold links', () => {
    expect(block).toMatch(/\.case-journey-reminder\.lift-help\s*\{\s*padding:\s*0/);
    expect(block).toMatch(
      /\.case-journey-reminder\.lift-help > summary\s*\{[^}]*font-size:\s*var\(--text-small\)/,
    );
    // The shared fold link size is the same token.
    expect(lastSize('.lift-help > summary')).toBe('var(--text-small)');
  });

  it('draws the header badge at the size of the line beside it', () => {
    expect(block).toMatch(
      /\.lift-case \.page-meta \.badge\s*\{[^}]*font-size:\s*var\(--text-small\)/,
    );
  });

  it('is flat', () => {
    expect(block).not.toMatch(/box-shadow|gradient|backdrop-filter|rgba\(/);
  });
});
