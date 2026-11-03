import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A link inside a sentence is underlined so colour is never its only sign. A card that is itself a
 * link carries a border and an arrow instead, so it must be left out of that rule. This reads the
 * stylesheet, because the rule's exclusions are a list that is easy to forget to extend.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
// The formatter may wrap the chain of exclusions, so compare without whitespace.
const flat = css.replace(/\s+/g, '');
const rule = /a:not\(\.btn\)[^{]*\{[^}]*text-decoration:underline/.exec(flat)?.[0] ?? '';

describe('card links are not underlined like sentence links', () => {
  it('finds the sentence-link rule', () => {
    expect(rule).toContain(':not(.attention-link)');
  });

  it.each(['.deadline-link', '.home-entry-link', '.plain-link'])('leaves %s out of it', (card) => {
    expect(rule).toContain(`:not(${card})`);
  });
});

describe('the documents list on a phone (UX13)', () => {
  const block = css.slice(css.indexOf('/* WP-UMPE-UX13'));
  it("gives a row's Manage button room under the file card, inside its padding", () => {
    expect(block).toMatch(/\.wallet-document-manage\s*\{[^}]*padding:/);
  });
});
