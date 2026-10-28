import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Owner list item 14: no visible text below 12px, 16px reading text and fields on phones, and
 * 44px targets on touch screens, all set once in the shared style sheet. The browser check in
 * `e2e/ux-public.spec.ts` measures real screens; this one keeps the style sheets honest on every
 * run.
 */
const APP = join(__dirname, '..', 'app');
const globals = readFileSync(join(APP, 'globals.css'), 'utf8');
const landing = readFileSync(join(APP, 'landing-c1.css'), 'utf8');

/**
 * The picture of a phone on the landing page shows the product at a phone's real scale, so its
 * sample words are part of a drawing (the figure is labelled "Illustrative interface with sample
 * information"), not text a visitor has to read. Its own caption is real text and is not listed.
 */
const ILLUSTRATION = new Set([
  '.c1 .c1-tinycap',
  '.c1 .c1-segment span',
  '.c1 .c1-fileinfo small',
  '.c1 .c1-tag',
  '.c1 .c1-next-label',
  '.c1 .c1-capsule',
  '.c1 .c1-bottomnav',
  '.c1 .c1-floatcard small',
  '.c1 .c1-floatcard b',
]);

interface SizedRule {
  readonly selector: string;
  readonly px: number;
}

/** The shared text scale, read from the style sheet itself, so a token counts as its real size. */
const SCALE: Record<string, number> = Object.fromEntries(
  [...globals.matchAll(/--(text-[a-z]+):\s*([0-9.]+)rem;/g)].map((m) => [
    m[1] as string,
    Number(m[2]) * 16,
  ]),
);

/** Every font size in a style sheet (plain or a scale token), in order, with its selector. */
function sizes(css: string): SizedRule[] {
  const found: SizedRule[] = [];
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] as string).trim().replace(/\s+/g, ' ');
    const body = rule[2] as string;
    for (const size of body.matchAll(
      /font-size:\s*(?:([0-9.]+)(px|rem)\b|var\(--(text-[a-z]+)\))/g,
    )) {
      const px = size[3]
        ? (SCALE[size[3]] ?? Number.NaN)
        : size[2] === 'rem'
          ? Number(size[1]) * 16
          : Number(size[1]);
      found.push({ selector, px });
    }
  }
  return found;
}

/** Sizes below 12px that no later rule for the very same selector lifts back to 12px or more. */
function tooSmall(css: string, exempt: ReadonlySet<string> = new Set()): string[] {
  const all = sizes(css);
  return all
    .filter((rule, index) => {
      if (rule.px === 0 || rule.px >= 12 || exempt.has(rule.selector)) return false;
      return !all
        .slice(index + 1)
        .some((later) => later.selector === rule.selector && later.px >= 12);
    })
    .map((rule) => `${rule.selector}: ${rule.px}px`);
}

/** The text of the QA-E block at the end of globals.css. */
function qaeBlock(): string {
  const start = globals.indexOf('/* WP-QAE');
  expect(start).toBeGreaterThan(0);
  const next = globals.slice(start + 1).search(/\n\/\* WP-/);
  return next === -1 ? globals.slice(start) : globals.slice(start, start + 1 + next);
}

describe('no visible text below 12px (owner list item 14)', () => {
  it('the shared style sheet sets no smaller size that stays in force', () => {
    expect(tooSmall(globals)).toEqual([]);
  });

  it('the landing sets none either, outside the drawing of a phone', () => {
    expect(tooSmall(landing, ILLUSTRATION)).toEqual([]);
  });

  it('reads the shared scale, whose smallest size is the 12px caption', () => {
    expect(SCALE['text-caption']).toBe(12);
    expect(Math.min(...Object.values(SCALE))).toBe(12);
  });

  it('catches a small size, and accepts one a later rule lifts to the caption size', () => {
    expect(tooSmall('.a { font-size: 10px; }')).toEqual(['.a: 10px']);
    expect(tooSmall('.a { font-size: 0.6rem; }')).toEqual(['.a: 9.6px']);
    expect(tooSmall('.a { font-size: 10px; }\n.a { font-size: 12px; }')).toEqual([]);
    expect(tooSmall('.a { font-size: 10px; }\n.b { font-size: 12px; }')).toEqual(['.a: 10px']);
    expect(tooSmall('.a { font-size: 10px; }\n.a { font-size: var(--text-caption); }')).toEqual([]);
  });

  it('keeps <small>, <h5> and <h6> inside caption-sized text at 12px or more', () => {
    expect(qaeBlock()).toMatch(/\n:where\(small\) \{\s*font-size: max\(12px, 0\.833em\);/);
    expect(qaeBlock()).toMatch(/\n:where\(h5\) \{\s*font-size: max\(12px, 0\.83em\);/);
    expect(qaeBlock()).toMatch(/\n:where\(h6\) \{\s*font-size: max\(12px, 0\.67em\);/);
  });

  it('makes reading text 16px and fields at least 16px on a phone, without capping or forcing', () => {
    const phone = qaeBlock().match(/@media \(max-width: 700px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    // Only the shared base sizes are restated; the small notes and utilities keep their sizes.
    expect(phone).toContain('.notice:where(:not(');
    expect(phone).toContain('.app-main .card-body:where(:not(');
    for (const deliberatelySmall of ['signup-consent', 'signup-notice-note', 'u-fs-']) {
      expect(phone).not.toContain(deliberatelySmall);
    }
    // Fields: at least 16px, never smaller than they were, and never forced.
    expect(phone).toMatch(/textarea,[\s\S]*?\{\s*font-size: max\(16px, 1em\);/);
    expect(phone).not.toContain('!important');
    expect(phone).not.toMatch(/:is\(main/);
  });
});

describe('44px targets on a touch screen, set once for every control (owner list item 14)', () => {
  const touch = () => qaeBlock().match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/)?.[1] ?? '';

  it('gives every control that stands on its own a weightless 44px floor when the pointer is coarse', () => {
    const floor = touch().match(/:where\(([\s\S]*?)\{\s*min-width: 44px;\s*min-height: 44px;\s*\}/);
    expect(floor).not.toBeNull();
    for (const control of ['a[href]', 'button', 'summary', 'select', '[role="button"]']) {
      expect(floor?.[1]).toContain(control);
    }
    // Hidden helpers are left alone, so an invisible file picker never grows over the page.
    expect(floor?.[1]).toContain(':where(:not(.sr-only, .skip-link))');
    // Weightless and never forced, so compact components keep their own sizes.
    expect(qaeBlock().replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('!important');
  });

  it('gives the compact controls a 44px hit area without growing them', () => {
    const block = touch();
    for (const compact of ['.record-plan-badge::before', '.brand-swatch::before']) {
      expect(block).toContain(compact);
    }
    expect(block).toMatch(/width: max\(100%, 44px\);\s*height: max\(100%, 44px\);/);
  });

  it('never applies the touch floor to a precise pointer, so the 34px account menu rows stay', () => {
    const block = qaeBlock();
    expect(block).not.toMatch(/pointer: fine/);
    const outsideTouch = block.replace(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/g, '');
    expect(outsideTouch).not.toMatch(/min-width: 44px;\s*min-height: 44px;/);
  });
});
