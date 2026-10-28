import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from './agency-brand';

/**
 * Guards for the "WP-G3" stylesheet block (progress ring, teaching empty states): it is one marked
 * block ahead of the reference codes block, it stays flat and on the shared tokens, every class the
 * ring uses is defined in it, and the words and lines it colours are readable.
 */

const SRC = join(__dirname, '..');
const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');

function block(marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`stylesheet block "${marker}" is missing`);
  const rest = css.slice(start);
  const next = rest.slice(marker.length).search(/\n\/\* WP-/);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

const g3 = block('/* WP-G3 ');
const rules = g3.replace(/\/\*[\s\S]*?\*\//g, '');
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const token = (name: string): string => {
  const match = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`token --${name} missing`);
  return match[1];
};
const rule = (selector: string): string => {
  const escaped = selector.replaceAll(/[.[\]():>+~ ]/g, (c) => `\\${c}`);
  return rules.match(new RegExp(`(?:^|\\n)${escaped} \\{[^}]*\\}`))?.[0] ?? '';
};

describe('the WP-G3 block is placed and marked like its neighbours', () => {
  it('appears once, ahead of the reference codes block, and ends at the next marker', () => {
    expect(css.split('/* WP-G3 ').length - 1).toBe(1);
    expect(css.indexOf('/* WP-G3 ')).toBeLessThan(css.indexOf('/* WP-REF '));
    expect(g3.slice(1)).not.toMatch(/\/\* WP-[A-Z0-9]+/);
    expect(g3.length).toBeGreaterThan(800);
  });
});

describe('the WP-G3 block stays flat and on the shared tokens', () => {
  it('has no literal colour, gradient, shadow, translucency, blur or animation', () => {
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(rules).not.toMatch(
      /gradient|box-shadow|text-shadow|drop-shadow|backdrop|filter|opacity|transition|animation|@keyframes|!important/,
    );
    expect(rules).not.toMatch(/prefers-color-scheme/);
  });

  it('colours text, strokes and borders only through tokens', () => {
    for (const line of rules.split('\n')) {
      if (/^\s*(color|background|stroke|fill|border(-left)?(-color)?)\s*:/.test(line)) {
        if (!/:\s*(0|none)\s*;/.test(line)) expect(line, line).toMatch(/var\(--[a-z0-9-]+\)/);
      }
    }
  });
});

describe('every class the ring uses is defined', () => {
  it('defines the ring, its parts and its states', () => {
    for (const name of [
      'progress-ring',
      'progress-ring-graphic',
      'progress-ring-sm',
      'progress-ring-lg',
      'progress-ring-track',
      'progress-ring-fill',
      'progress-ring-full',
      'progress-ring-centre',
      'progress-ring-text',
      'progress-ring-words',
      'progress-ring-line',
      'progress-ring-action',
      'progress-ring-row',
      'empty-state-why',
    ]) {
      expect(rules, name).toContain(`.${name}`);
    }
  });

  it('colours the ring so it reads against the page: the fill, the full state and the empty track', () => {
    expect(rule('.progress-ring-fill')).toMatch(/stroke: var\(--accent\)/);
    expect(rule('.progress-ring-full .progress-ring-fill')).toMatch(/stroke: var\(--success\)/);
    expect(rule('.progress-ring-track')).toMatch(/stroke: var\(--edge-control\)/);
  });
});

describe('targets and readability', () => {
  it('gives the way to pick a checklist a 44 pixel target', () => {
    expect(rule('.progress-ring-action')).toContain('min-height: 44px');
  });

  it('keeps even the small ring at least 44 pixels across', () => {
    expect(rule('.progress-ring-sm .progress-ring-graphic')).toContain('width: 2.75rem');
  });

  it('lets nothing push the page wider than the screen', () => {
    expect(rule('.progress-ring')).toContain('max-width: 100%');
    expect(rule('.progress-ring')).toContain('min-width: 0');
    expect(rule('.progress-ring-text')).toContain('min-width: 0');
    expect(rule('.progress-ring-words')).toContain('overflow-wrap: anywhere');
    expect(rule('.progress-ring-line')).toContain('overflow-wrap: anywhere');
  });

  it('reads the words, the line and the link at 4.5 to 1 or better on the cards and the page', () => {
    const grounds = ['bg-elevated', 'bg', 'bg-subtle'].map(token);
    for (const [name, selector] of [
      ['text-secondary', '.progress-ring-words'],
      ['text-secondary', '.progress-ring-line'],
      ['text-secondary', '.empty-state-why'],
      ['accent', '.progress-ring-action'],
      ['text', '.progress-ring-centre'],
    ] as const) {
      expect(rule(selector), selector).toContain(`var(--${name})`);
      for (const ground of grounds) {
        expect(contrast(token(name), ground), `${selector} on ${ground}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('draws the ring itself at 3 to 1 or better against the card, as a graphic should', () => {
    for (const name of ['accent', 'success']) {
      expect(contrast(token(name), token('bg-elevated')), name).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the older case summary no longer styles the ring it replaced', () => {
  it('has no leftover rule that would recolour the new ring', () => {
    expect(css).not.toMatch(/\.case-preparation-ring (svg|span|strong|> div)/);
  });
});
