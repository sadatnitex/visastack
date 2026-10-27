import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from './agency-brand';

/**
 * Guards for the "WP-G5" stylesheet block (the deadline clock): it is one marked block ahead of the
 * reference codes block, it stays flat and on the shared tokens, every class the clock draws is
 * defined in it, each tone has its own colour, and the words it colours are readable.
 */

const SRC = join(__dirname, '..');
const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
const component = readFileSync(join(SRC, 'components', 'deadline-clock.tsx'), 'utf8');

function block(marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`stylesheet block "${marker}" is missing`);
  const rest = css.slice(start);
  const next = rest.slice(marker.length).search(/\n\/\* WP-/);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

const g5 = block('/* WP-G5 ');
const rules = g5.replace(/\/\*[\s\S]*?\*\//g, '');
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

describe('the WP-G5 block is placed and marked like its neighbours', () => {
  it('appears once, ahead of the reference codes block, and ends at the next marker', () => {
    expect(css.split('/* WP-G5 ').length - 1).toBe(1);
    expect(css.indexOf('/* WP-G5 ')).toBeLessThan(css.indexOf('/* WP-REF '));
    expect(g5.slice(1)).not.toMatch(/\/\* WP-[A-Z0-9]+/);
    expect(g5.length).toBeGreaterThan(800);
  });
});

describe('the WP-G5 block stays flat and on the shared tokens', () => {
  it('has no literal colour, gradient, shadow, translucency, blur or animation', () => {
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(rules).not.toMatch(
      /gradient|box-shadow|text-shadow|drop-shadow|backdrop|filter|opacity|transition|animation|@keyframes|!important|url\(|data:/,
    );
    expect(rules).not.toMatch(/prefers-color-scheme/);
  });

  it('colours text, backgrounds and borders only through tokens', () => {
    for (const line of rules.split('\n')) {
      if (/^\s*(color|background|border(-left)?(-color)?)\s*:/.test(line)) {
        if (!/:\s*(0|none)\s*;/.test(line)) expect(line, line).toMatch(/var\(--[a-z0-9-]+\)/);
      }
    }
  });
});

describe('every class the clock draws is defined', () => {
  // Class names only: not the file name in the import path, and not `deadline-tone-${urgency}`,
  // which is built at run time and checked below.
  const used = [
    ...new Set(component.match(/(?<![\w/-])deadline-[a-z]+(?:-[a-z]+)*(?![\w-]|\$)/g) ?? []),
  ].filter((name) => !name.startsWith('deadline-tone-'));

  it('finds the classes the component uses', () => {
    expect(used.length).toBeGreaterThan(10);
  });

  it('defines each one', () => {
    for (const name of used) expect(rules, name).toContain(`.${name}`);
  });

  it('gives each of the four tones its own marker colour', () => {
    expect(rule('.deadline-tone-overdue')).toMatch(/border-left-color: var\(--danger\)/);
    expect(rule('.deadline-tone-soon')).toMatch(/border-left-color: var\(--warning\)/);
    expect(rule('.deadline-tone-month')).toMatch(/border-left-color: var\(--accent\)/);
    expect(rule('.deadline-tone-later')).toMatch(/border-left-color: var\(--hairline\)/);
  });

  it('marks a date to check with a dashed border, not by colour', () => {
    expect(rule('.deadline-line-check')).toContain('border-style: dashed');
    expect(rule('.deadline-tag-check')).toContain('1px dashed');
  });
});

describe('targets and readability', () => {
  it('keeps the whole line from being underlined, and names it on hover instead', () => {
    expect(rule('.deadline-link')).toContain('text-decoration: none');
    expect(rule('.deadline-link:hover .deadline-name')).toContain('text-decoration: underline');
  });

  it('gives the line and the link a 44 pixel target', () => {
    expect(rule('.deadline-link')).toContain('min-height: 44px');
    expect(rule('.deadline-more-link')).toContain('min-height: 44px');
  });

  it('lets nothing push the page wider than the screen', () => {
    expect(rule('.deadline-clock')).toContain('min-width: 0');
    expect(rule('.deadline-main')).toContain('min-width: 0');
    expect(rule('.deadline-link')).toContain('flex-wrap: wrap');
    for (const selector of [
      '.deadline-name',
      '.deadline-phrase',
      '.deadline-date',
      '.deadline-why',
    ]) {
      expect(rule(selector), selector).toContain('overflow-wrap: anywhere');
    }
  });

  it('reads every word at 4.5 to 1 or better on the card and the page', () => {
    const grounds = ['bg-elevated', 'bg', 'bg-subtle'].map(token);
    for (const [name, selector] of [
      ['text', '.deadline-name'],
      ['text', '.deadline-phrase'],
      ['text-secondary', '.deadline-date'],
      ['text-secondary', '.deadline-why'],
      ['text-secondary', '.deadline-clock-note'],
      ['accent', '.deadline-more-link'],
    ] as const) {
      expect(rule(selector), selector).toContain(`var(--${name})`);
      for (const ground of grounds) {
        expect(contrast(token(name), ground), `${selector} on ${ground}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('reads each tag word on its own background at 4.5 to 1 or better', () => {
    for (const [selector, text, ground] of [
      ['.deadline-tag', 'text-secondary', 'bg-subtle'],
      ['.deadline-tone-overdue .deadline-tag-tone', 'danger', 'danger-bg'],
      ['.deadline-tone-soon .deadline-tag-tone', 'warning', 'warning-bg'],
      ['.deadline-tone-month .deadline-tag-tone', 'accent', 'bg-subtle'],
      ['.deadline-tag-check', 'text', 'bg-elevated'],
    ] as const) {
      const body = rule(selector);
      expect(body, selector).toContain(`color: var(--${text})`);
      expect(body, selector).toContain(`background: var(--${ground})`);
      expect(contrast(token(text), token(ground)), selector).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws the tone marker and the dashed edge at 3 to 1 or better against the card', () => {
    for (const name of ['danger', 'warning', 'accent']) {
      expect(contrast(token(name), token('bg-elevated')), name).toBeGreaterThanOrEqual(3);
    }
  });
});
