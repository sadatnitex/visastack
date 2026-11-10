import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The conversation's look (WP-RT1): flat tone fills, shared tokens, a 44px target for its fold. */
const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
const START = css.lastIndexOf('/* WP-RT1 ');
const END = css.indexOf('/* end WP-RT1 */', START);
const block = css.slice(START, END);
const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the requests thread block', () => {
  it('is one whole block of the stylesheet', () => {
    expect(START).toBeGreaterThan(-1);
    expect(END).toBeGreaterThan(START);
    expect(css.match(/\/\* WP-RT1 /g)).toHaveLength(1);
  });

  it('is flat: no shadow, gradient, picture, translucency, blur or tail', () => {
    expect(rules).not.toMatch(
      /box-shadow|text-shadow|drop-shadow|gradient|backdrop-filter|filter:|opacity/,
    );
    expect(rules).not.toMatch(/rgba?\(|hsla?\(|url\(|clip-path|::before|::after/);
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('puts the two sides on opposite edges with a tone fill each', () => {
    expect(rules).toMatch(
      /\.rt-msg-other\s*\{[^}]*align-self:\s*flex-start[^}]*background:\s*var\(--bg-subtle\)/,
    );
    expect(rules).toMatch(
      /\.rt-msg-own\s*\{[^}]*align-self:\s*flex-end[^}]*background:\s*var\(--brand-bg\)/,
    );
  });

  it('keeps the way to open the agency conversation a 44px target', () => {
    expect(rules).toMatch(/\.request-conversation > summary\s*\{[^}]*min-height:\s*44px/);
  });

  it('gives the panel the side column on a wide screen, as the case page does', () => {
    expect(rules).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 24rem/);
    expect(rules).toMatch(/\.req-grid > \.lp-root > \.lp-pane\s*\{[^}]*position:\s*sticky/);
  });
});
