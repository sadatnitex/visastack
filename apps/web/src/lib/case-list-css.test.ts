import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Trips list's look (WP-P12): flat, tokens only, 44px targets, one fixed grid so a long name
 * never moves the chip, and every chip pair readable (WCAG 2 AA, 4.5:1). Read from the stylesheet.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
const START = css.lastIndexOf('/* WP-P12 ');
const END = css.indexOf('/* end WP-P12 */', START);
const block = css.slice(START, END);
const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');

const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}\n', css.indexOf(':root {')));
function token(name: string): string {
  const found = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!found?.[1]) throw new Error(`token --${name} not found`);
  return found[1];
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('the Trips list block', () => {
  it('is one whole block of the stylesheet', () => {
    expect(START).toBeGreaterThan(-1);
    expect(END).toBeGreaterThan(START);
    expect(css.match(/\/\* WP-P12 /g)).toHaveLength(1);
  });

  it('is flat: no shadow, gradient, blur, translucency or animation', () => {
    expect(rules).not.toMatch(
      /gradient|box-shadow|text-shadow|drop-shadow|backdrop|filter|opacity|transition|animation|!important|rgba\(|hsla\(/,
    );
  });

  it('keeps the card on a fixed grid so a long name never moves the chip', () => {
    expect(rules).toMatch(
      /\.case-row\s*\{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\) 20px/,
    );
    expect(rules).toMatch(/\.case-row-title\s*\{[^}]*white-space:\s*nowrap/);
    expect(rules).toMatch(/\.case-row-title\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(rules).toMatch(/\.case-row-chipline\s*\{[^}]*display:\s*flex/);
  });

  it('sets the name at 17px bold, the flag at 44px and the bar at 8px', () => {
    expect(rules).toMatch(
      /\.case-row-title\s*\{[^}]*font-size:\s*1\.0625rem[^}]*font-weight:\s*750/,
    );
    expect(rules).toMatch(
      /\.country-flag\[data-size="lg"\]\s*\{[^}]*width:\s*44px;\s*height:\s*44px/,
    );
    expect(rules).toMatch(/\.case-bar-track\s*\{[^}]*height:\s*8px/);
  });

  it('keeps a visible stub on an empty bar and a 44px target on the whole card and the fold', () => {
    expect(rules).toMatch(/\.case-bar\[data-empty="true"\]::after\s*\{[^}]*width:\s*8px/);
    expect(rules).toMatch(/\.case-row\s*\{[^}]*min-height:\s*(\d+)px/);
    const rowHeight = Number(rules.match(/\.case-row\s*\{[^}]*min-height:\s*(\d+)px/)?.[1]);
    expect(rowHeight).toBeGreaterThanOrEqual(44);
    const foldHeight = Number(
      rules.match(/\.case-past-fold > summary\s*\{[^}]*min-height:\s*(\d+)px/)?.[1],
    );
    expect(foldHeight).toBeGreaterThanOrEqual(44);
  });

  it('takes every chip colour from the six Harbor tones, never a new colour, and keeps white readable on each', () => {
    expect(rules).toMatch(
      /\.case-chip\[data-tone\]\s*\{[^}]*background:\s*var\(--tone\)[^}]*color:\s*#ffffff/,
    );
    // The chip rules name no colour of their own besides the white text and the grey ground.
    const chipRules = rules.match(/\.case-chip[^{]*\{[^}]*\}/g)?.join('') ?? '';
    const colours = chipRules.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect([...new Set(colours)]).toEqual(['#ffffff']);
    const tones = [...css.matchAll(/\[data-tone="([a-z]+)"\]\s*\{\s*--tone:\s*(#[0-9a-fA-F]{6})/g)];
    for (const name of ['green', 'amber', 'red', 'blue']) {
      const hex = tones.find((match) => match[1] === name)?.[2];
      expect(hex, `tone ${name}`).toBeDefined();
      expect(contrast('#ffffff', hex ?? '#ffffff'), `white on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(rules).toMatch(/\.case-chip\s*\{[^}]*background:\s*var\(--bg-subtle\)/);
    expect(contrast(token('text'), token('bg-subtle'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the other text readable on the card: next step, count, muted line, letters badge', () => {
    expect(contrast(token('brand'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('text-secondary'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('brand'), token('brand-bg'))).toBeGreaterThanOrEqual(4.5);
    // The card turns pale blue on hover; the next step stays readable there too.
    expect(contrast(token('brand'), token('brand-tint-1'))).toBeGreaterThanOrEqual(4.5);
  });

  it('gives the chip a dot', () => {
    expect(rules).toMatch(
      /\.case-chip-dot\s*\{[^}]*width:\s*8px;\s*height:\s*8px;\s*border-radius:\s*50%/,
    );
  });
});
