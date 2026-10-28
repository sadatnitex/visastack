import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for WP-C2 (surfaces and edges by role): each changed rule takes its colour from a token,
 * stays flat (no literal colour, translucency, gradient, shadow, filter, animation or !important),
 * and uses the token its role names. Read from the stylesheet itself, so it cannot drift.
 */

const SRC = join(__dirname, '..');
const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
const landing = readFileSync(join(SRC, 'app', 'page.tsx'), 'utf8');

/** The body of every rule written with exactly this selector, in order (media blocks included). */
function rules(selector: string): string[] {
  const escaped = selector.replaceAll(/[.[\]():>+~*"=]/g, (c) => `\\${c}`);
  return [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, 'g'))].map(
    (match) => match[1] ?? '',
  );
}

/** The last rule for this selector that sets the property (any property when none is named). */
function last(selector: string, property?: string): string {
  const found = rules(selector).filter(
    (body) => property === undefined || new RegExp(`(^|[;\\s])${property}:`).test(body),
  );
  const body = found.at(-1);
  if (body === undefined) throw new Error(`no rule for ${selector} ${property ?? ''}`);
  return body;
}

const FLAT_BREAKERS = /#[0-9a-fA-F]{3,8}\b|rgba?\(|gradient|shadow|filter|animation|!important/;

const PRESSED_SEGMENT = [
  '.depth-scope[data-depth="glance"] .depth-seg[data-for="glance"],',
  '.depth-scope[data-depth="browse"] .depth-seg[data-for="browse"],',
  '.depth-scope[data-depth="everything"] .depth-seg[data-for="everything"],',
  '.depth-scope[data-depth="auto"] .depth-seg[data-for="browse"] {',
].join('\n');

describe('surfaces and edges by role (WP-C2)', () => {
  it('gives cards the card edge, and controls the control edge', () => {
    expect(rules('.card')[0]).toMatch(/border-color: var\(--edge-card\);\n/);
    expect(last('.btn-secondary', 'border-color')).toMatch(/border-color: var\(--edge-control\);/);
    expect(rules('.workspace-selector')[0]).toMatch(/border: 1px solid var\(--edge-card\);/);
    expect(rules('.record-search')[0]).toMatch(/border: 1px solid var\(--edge-card\);/);
    expect(rules('.account-menu-panel')[0]).toMatch(/border: 1px solid var\(--edge-control\);/);
  });

  it('keeps the header white and 83px high, with the stronger line under it', () => {
    const toolbar = rules('.workspace-toolbar')[0] ?? '';
    expect(toolbar).toMatch(/background: #ffffff;/);
    expect(toolbar).toMatch(/min-height: 83px;/);
    expect(toolbar).toMatch(/border-bottom: 1px solid var\(--hairline\);/);
  });

  it('marks the current page with a white pill and a brand bar, never colour alone', () => {
    const active = last('.app-shell-links a[aria-current="page"]');
    expect(active).toMatch(/background: var\(--bg-elevated\);/);
    expect(active).toMatch(/border: 1px solid var\(--edge-card\);/);
    expect(active).toMatch(/font-weight: 650;/);
    expect(active).toMatch(/position: relative;/);
    const bar = last('.app-shell-links a[aria-current="page"]::before');
    expect(bar).toMatch(/content: "";/);
    expect(bar).toMatch(/width: 3px;/);
    expect(bar).toMatch(/background: var\(--brand\);/);
    // The phone bottom bar keeps its own look: no pill and no bar there.
    expect(last('.app-bar a[aria-current="page"]::before')).toMatch(/content: none;/);
    expect(last('.account-menu-row[aria-current="page"]')).toMatch(
      /background: var\(--brand-tint-3\);/,
    );
  });

  it('outlines the pressed level of the depth switch in the brand colour, on wide and phone screens', () => {
    const wide = css.indexOf(PRESSED_SEGMENT);
    expect(wide).toBeGreaterThan(-1);
    const pressed = css.slice(wide + PRESSED_SEGMENT.length, css.indexOf('}', wide));
    expect(pressed).toMatch(/border-color: var\(--brand\);/);
    expect(pressed).not.toMatch(FLAT_BREAKERS);
    expect(last('.depth-scope[data-depth="auto"] .depth-seg[data-for="glance"]')).toMatch(
      /border-color: var\(--brand\);/,
    );
  });

  it('draws the empty part of a progress ring at 3:1, and every placeholder in the meta tier', () => {
    expect(last('.progress-ring-track')).toMatch(/stroke: var\(--edge-control\);/);
    const placeholder = last('::placeholder');
    expect(placeholder).toMatch(/color: var\(--text-tertiary\);/);
    expect(placeholder).toMatch(/opacity: 1;/);
  });

  it('keeps every changed rule flat and on tokens', () => {
    for (const selector of [
      '.btn-secondary',
      '.app-shell-links a[aria-current="page"]',
      '.app-shell-links a[aria-current="page"]::before',
      '.account-menu-row[aria-current="page"]',
      '.progress-ring-track',
      '::placeholder',
    ]) {
      expect(last(selector), selector).not.toMatch(FLAT_BREAKERS);
    }
    expect(rules('.card')[0]).not.toMatch(FLAT_BREAKERS);
    for (const body of [
      rules('.workspace-selector')[0],
      rules('.record-search')[0],
      rules('.account-menu-panel')[0],
    ]) {
      expect(body).not.toMatch(/gradient|shadow|filter|animation|!important/);
    }
  });

  it('has removed the ghost numerals from the landing steps', () => {
    expect(css).not.toContain('land-step-num');
    expect(landing).not.toContain('land-step-num');
    expect(landing).toContain('Step {index + 1}');
  });
});
