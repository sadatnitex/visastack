import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The purpose pictures' look (WP-P15): flat, tokens only, a 44px target on every tile, two
 * columns on a phone, and the real radio button kept on the keyboard path. Read from the stylesheet.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
const START = css.lastIndexOf('/* WP-P15 ');
const END = css.indexOf('/* end WP-P15 */', START);
const rules = css.slice(START, END).replace(/\/\*[\s\S]*?\*\//g, '');

describe('the purpose picture block', () => {
  it('is one whole block of the stylesheet', () => {
    expect(START).toBeGreaterThan(-1);
    expect(END).toBeGreaterThan(START);
    expect(css.match(/\/\* WP-P15 /g)).toHaveLength(1);
  });

  it('is flat and takes every colour from a token', () => {
    expect(rules).not.toMatch(
      /gradient|box-shadow|text-shadow|drop-shadow|backdrop|filter|opacity|transition|animation|!important|rgba\(|hsla\(/,
    );
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('is two columns on a phone and more room on wider screens', () => {
    expect(rules).toMatch(
      /\.purpose-tile-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(rules).toMatch(/@media \(min-width: 640px\)\s*\{\s*\.purpose-tile-grid/);
  });

  it('gives every tile a 44px target and a visible keyboard focus', () => {
    const height = Number(rules.match(/\.purpose-tile-face\s*\{[^}]*min-height:\s*(\d+)px/)?.[1]);
    expect(height).toBeGreaterThanOrEqual(44);
    expect(rules).toMatch(
      /\.purpose-tile-input:focus-visible \+ \.purpose-tile-face[^{]*\{[^}]*outline:\s*3px solid var\(--accent\)/,
    );
  });

  it('hides the radio button from the eye, not from the keyboard or a screen reader', () => {
    const input = rules.match(/\.purpose-tile-input\s*\{[^}]*\}/)?.[0] ?? '';
    expect(input).toContain('clip-path');
    expect(input).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });

  it('shows the chosen tile with the brand colour, not by colour alone (a thicker edge too)', () => {
    const checked =
      rules.match(/\.purpose-tile-input:checked \+ \.purpose-tile-face\s*\{[^}]*\}/)?.[0] ?? '';
    expect(checked).toContain('var(--brand)');
    expect(checked).toContain('border-width: 2px');
  });
});
