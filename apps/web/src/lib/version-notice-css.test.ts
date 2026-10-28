import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Hide button of the notice about this version sits in the notice's end padding. Under every
 * combination of screen width and pointer, that padding must be at least the button's width plus
 * a gap, or the button covers the last words and the What Works Today link (review item 1).
 *
 * Browsers pick, for each property, the winning declaration by weight and then by source order. So
 * this reads every rule in the shared style sheet, with the media query around it, and checks the
 * reasoning directly: the one rule that decides the end padding comes after every other rule that
 * could set it, applies under every media query, and is written as the button width plus a gap,
 * where both widths come from the same variable.
 */
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

interface Rule {
  readonly selectors: readonly string[];
  readonly media: string;
  readonly declarations: ReadonlyMap<string, string>;
  readonly order: number;
}

/** Every style rule in source order, with the media query around it ('' at the top level). */
function rules(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Rule[] = [];
  const stack: string[] = [];
  let buffer = '';
  for (const character of text) {
    if (character === '{') {
      stack.push(buffer.trim());
      buffer = '';
    } else if (character === '}') {
      const prelude = stack.pop() ?? '';
      if (!prelude.startsWith('@')) {
        const declarations = new Map<string, string>();
        for (const part of buffer.split(';')) {
          const colon = part.indexOf(':');
          if (colon > 0)
            declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
        }
        found.push({
          selectors: prelude.split(',').map((selector) => selector.trim().replace(/\s+/g, ' ')),
          media: stack.filter((item) => item.startsWith('@media')).join(' and '),
          declarations,
          order: found.length,
        });
      }
      buffer = '';
    } else buffer += character;
  }
  return found;
}

const ALL = rules(css);
/** Anything that can set the notice's end padding (right-to-left is not used by the product). */
const END_PADDING = ['padding', 'padding-inline', 'padding-inline-end', 'padding-right'];
const setsEnd = (rule: Rule) => END_PADDING.some((property) => rule.declarations.has(property));
/** A selector that matches the notice element itself, at any weight. */
const isNotice = (selector: string) => /^\.pilot-banner(\.pilot-banner-slim)?$/.test(selector);

describe('the notice keeps room for its Hide button under every width and pointer', () => {
  const deciding = ALL.filter((rule) => rule.selectors.some(isNotice) && setsEnd(rule));

  it('has one unconditional rule, after all the others, that sets the end padding from the button width', () => {
    const last = deciding.at(-1);
    expect(last?.media).toBe('');
    expect(last?.selectors).toEqual(['.pilot-banner']);
    expect(last?.declarations.get('padding-inline-end')).toBe(
      'calc(var(--notice-hide) + var(--space-2))',
    );
    // Every earlier rule loses to it: same or lower weight, earlier in the sheet.
    for (const rule of deciding.slice(0, -1)) {
      expect(rule.selectors.every((selector) => selector === '.pilot-banner')).toBe(true);
    }
  });

  it('lets nothing heavier set the end padding of the notice', () => {
    // Any selector whose last part is the notice itself (with more classes, a parent, a state).
    const targetsNotice = (selector: string) =>
      /(^|[\s>+~])[^\s>+~]*\.pilot-banner(?![-\w])[^\s>+~]*$/.test(selector);
    const others = ALL.filter(
      (rule) =>
        setsEnd(rule) &&
        rule.selectors.some((selector) => targetsNotice(selector) && selector !== '.pilot-banner'),
    );
    expect(others.map((rule) => rule.selectors.join(', '))).toEqual([]);
    for (const rule of ALL.filter((item) => item.selectors.some(targetsNotice))) {
      for (const property of END_PADDING) {
        expect(rule.declarations.get(property) ?? '').not.toContain('!important');
      }
    }
  });

  it('draws the button exactly as wide as that variable, under every width and pointer', () => {
    const widths = ALL.filter(
      (rule) =>
        rule.selectors.some((selector) => selector.endsWith('.pilot-banner-hide')) &&
        (rule.declarations.has('width') || rule.declarations.has('min-width')),
    );
    expect(widths.length).toBeGreaterThan(0);
    for (const rule of widths) {
      expect(rule.declarations.get('width') ?? 'var(--notice-hide)').toBe('var(--notice-hide)');
      expect(rule.declarations.get('min-width') ?? '0').toBe('0');
    }
  });

  it('sets the variable to 32px for a precise pointer, 44px on touch, and 0 in the slim label', () => {
    const values = ALL.filter((rule) => rule.declarations.has('--notice-hide')).map((rule) => [
      rule.selectors.join(', '),
      rule.media,
      rule.declarations.get('--notice-hide'),
    ]);
    expect(values).toEqual([
      ['.pilot-banner', '', '2rem'],
      ['.pilot-banner.pilot-banner-slim', '', '0px'],
      ['.pilot-banner', '@media (pointer: coarse)', '44px'],
      ['.pilot-banner.pilot-banner-slim', '@media (pointer: coarse)', '0px'],
    ]);
  });
});
