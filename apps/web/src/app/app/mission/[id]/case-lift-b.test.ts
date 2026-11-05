import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the WP-LIFT-B parts of the case page: the stylesheet block (flat, tokens only, the
 * folds that never hide a way in), and the component files (every `lift-` class they write is
 * defined, no inline styles). The shared Lift components have their own guards in ui-lift.test.tsx.
 */

const here = __dirname;
const css = readFileSync(join(here, '..', '..', '..', 'globals.css'), 'utf8');

const sliceBetween = (from: string, to: string): string => {
  const start = css.indexOf(from);
  const end = css.indexOf(to);
  return start < 0 || end < 0 ? '' : css.slice(start, end);
};
const blockB = sliceBetween('/* WP-LIFT-B', '/* end WP-LIFT-B */');
const blockA = sliceBetween('/* WP-LIFT-A', '/* end WP-LIFT-A */');

const FILES = [
  'case-rail.tsx',
  'case-secondary.tsx',
  'case-mobile-bar.tsx',
  'trip-checks-panel.tsx',
  'rail-fold.tsx',
  'mission-buttons.tsx',
];
const read = (file: string) => readFileSync(join(here, file), 'utf8');

/** The text of the at-rule that starts at `header`, braces matched. */
function atRule(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start < 0) return '';
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

describe('the WP-LIFT-B stylesheet block', () => {
  it('exists, is long enough to be the block and carries only its own marker pair', () => {
    expect(blockB.length).toBeGreaterThan(4000);
    expect(css.match(/\/\* WP-LIFT-B /g)).toHaveLength(1);
    expect(css.match(/\/\* end WP-LIFT-B \*\//g)).toHaveLength(1);
  });

  it('is flat and uses tokens only: no colour of its own, no shadow, gradient or see-through ground', () => {
    const own = blockB.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(own).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(own).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(own).not.toMatch(/gradient\(|box-shadow|text-shadow|backdrop-filter|filter:|opacity/);
    expect(own).not.toMatch(/transition|animation/);
    expect(own).not.toMatch(/!important/);
  });

  it('defines every lift- class the rail, the More card, the bar and the forms write', () => {
    const defined = blockA + blockB;
    const missing: string[] = [];
    for (const file of FILES) {
      for (const match of read(file).matchAll(/\blift-[a-z0-9]+(?:-[a-z0-9]+)*/g)) {
        const token = match[0];
        if (!new RegExp(`\\.${token}(?![a-z0-9-])`).test(defined))
          missing.push(`${file}: ${token}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('keeps every touch target at 44px or more', () => {
    expect(blockB).toMatch(/\.jump-nav a \{[^}]*min-height: 44px;/s);
    expect(blockB).toMatch(/\.lift-form-check \{[^}]*min-height: 44px;/s);
    expect(blockB).toMatch(/\.lift-rail-edit > summary \{[^}]*min-height: 44px;/s);
    expect(blockB).toMatch(/\.row\.lift-snap \{[^}]*min-height: 56px;/s);
  });

  it('hides a fold row on a wide screen only where the browser can still show the card', () => {
    // A closed details hides its content; the wide screen shows the card by overriding that,
    // which only some browsers can do. The row may go only inside that exact test, or a browser
    // that cannot do it would have a rail with nothing in it and no way to open it.
    const supports = atRule(blockB, '@supports selector(::details-content)');
    expect(supports).toContain('(min-width: 761px)');
    expect(supports).toMatch(/\.lift-fold > \.lift-action-summary \{\s*display: none;/);
    expect(supports).toMatch(/\.lift-fold::details-content \{\s*content-visibility: visible;/);
    const outside = blockB.replace(supports, '');
    expect(outside).not.toMatch(/\.lift-fold > \.lift-action-summary \{[^}]*display: none/);
    expect(outside).not.toMatch(/\.lift-fold[^{]*\{[^}]*display: none/);
  });

  it('keeps the section links scrolling inside their own box on a phone, never the page', () => {
    const phone = atRule(blockB, '@media (max-width: 760px) {\n  .jump-nav');
    expect(phone).toMatch(/\.jump-nav \{[^}]*flex-wrap: nowrap;/s);
    expect(phone).toMatch(/\.jump-nav \{[^}]*overflow-x: auto;/s);
    expect(blockB).toMatch(/\.jump-nav \{[^}]*max-width: 100%;/s);
  });

  it('draws the phone bar as a note and one button side by side, with a 40px bar', () => {
    expect(blockB).toMatch(/\.lift-bar-progress \.lift-meter \{\s*width: 2\.5rem;/);
    const phone = atRule(blockB, '@media (max-width: 640px)');
    expect(phone).toMatch(/\.case-sticky-next \.sticky-action-bar \{[^}]*grid-template-columns/s);
  });
});

describe('the WP-LIFT-B component files', () => {
  it.each(FILES)('%s has no inline style', (file) => {
    expect(read(file)).not.toMatch(/style=\{\{/);
  });
});
