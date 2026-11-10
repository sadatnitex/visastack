import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The look of batch F1 (familiar patterns), read from the stylesheet so a later rule that adds a
 * shadow, a gradient or an always-on animation, or that lets the Add button show beside the
 * page's own filled button on a phone, is caught here.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');

function blockOf(name: string): string {
  const start = css.lastIndexOf(`/* ${name} `);
  const end = css.indexOf(`/* end ${name} */`, start);
  expect(start, `${name} starts`).toBeGreaterThan(-1);
  expect(end, `${name} ends`).toBeGreaterThan(start);
  expect(css.match(new RegExp(`/\\* ${name} `, 'g')), `${name} once`).toHaveLength(1);
  // Comments say "no shadow" and "no gradient"; only the rules count.
  return css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
}
const strip = blockOf('WP-F1A');
const steps = blockOf('WP-F1B');
const boxes = blockOf('WP-F1C');

describe('every F1 block is flat', () => {
  it('has no shadow, gradient, blur or translucent surface', () => {
    for (const block of [strip, steps, boxes]) {
      expect(block).not.toMatch(
        /box-shadow|text-shadow|drop-shadow|gradient|backdrop-filter|blur\(/,
      );
      expect(block).not.toMatch(/rgba\(|opacity:\s*0?\.\d/);
    }
  });
});

describe('the done strip', () => {
  it('is a 1px bordered line with a 44px close target', () => {
    expect(strip).toMatch(/\.toast\s*\{[^}]*border:\s*1px solid/);
    expect(strip).toMatch(/\.toast-close\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/);
  });

  it('moves only when the person has not asked for less motion', () => {
    // No animation anywhere in the block outside the no-preference query.
    const outside = strip.replace(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}\n/,
      '',
    );
    expect(strip).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(outside).not.toMatch(/animation|transition/);
  });

  it('sits above the phone bar, and higher still above a sticky action bar or the Add button', () => {
    expect(strip).toMatch(
      /@media \(max-width: 1023px\)\s*\{\s*\.toast-region\s*\{\s*bottom:\s*calc\(5rem \+ env\(safe-area-inset-bottom/,
    );
    expect(strip).toMatch(/html:has\(\.sticky-action-bar\) \.toast-region/);
    expect(strip).toMatch(/html:has\(\.docs-add-fab\) \.toast-region/);
  });

  it('lets taps through the empty part of its region', () => {
    expect(strip).toMatch(/\.toast-region\s*\{[^}]*pointer-events:\s*none/);
    expect(strip).toMatch(/\.toast\s*\{[^}]*pointer-events:\s*auto/);
  });

  it('stays above the page but below nothing it must not cover (the sticky bar is z-index 30)', () => {
    const z = Number(strip.match(/\.toast-region\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
    expect(z).toBeGreaterThan(40);
  });
});

describe('the count on a tab', () => {
  it('has the bell count shape and the danger fill with white text', () => {
    expect(strip).toMatch(/\.app-tab-badge\s*\{[^}]*border-radius:\s*10px/);
    expect(strip).toMatch(/\.app-tab-badge\s*\{[^}]*background:\s*var\(--danger-strong\)/);
    expect(strip).toMatch(/\.app-tab-badge\s*\{[^}]*color:\s*#fff/);
    expect(css).toMatch(/\.record-unread\s*\{[^}]*border-radius:\s*10px/);
  });

  it('sits on the icon on a phone and ends the row on a laptop', () => {
    expect(strip).toMatch(/\.app-tab-badge\s*\{[^}]*margin-inline-start:\s*auto/);
    expect(strip).toMatch(
      /@media \(max-width: 1023px\)[\s\S]*\.app-bar \.app-tab-badge\s*\{[^}]*position:\s*absolute/,
    );
  });
});

describe('the case stages', () => {
  it('goes down a line on a phone when the stages are opened, with the current one marked', () => {
    expect(steps).toMatch(/@media \(max-width: 760px\)/);
    expect(steps).toMatch(/\.lift-step\s*\{[^}]*min-height:\s*44px/);
    expect(steps).toMatch(/\.lift-step-current::before\s*\{[^}]*background:\s*var\(--brand\)/);
    expect(steps).toMatch(/\.lift-step-current\s*\{[^}]*font-weight:\s*700/);
  });

  it('keeps the strip for a phone and shows the headline first', () => {
    expect(steps).toMatch(
      /grid-template-areas:\s*"now help"\s*"position position"\s*"strip strip"/,
    );
  });
});

describe('the code boxes', () => {
  it('draws 1px boxes at least 52px tall over a real input that takes the taps', () => {
    expect(boxes).toMatch(/\.code-box\s*\{[^}]*border:\s*1px solid/);
    expect(boxes).toMatch(/\.code-box\s*\{[^}]*min-height:\s*52px/);
    expect(boxes).toMatch(/\[data-drawn="true"\] \.code-boxes-input\s*\{[^}]*position:\s*absolute/);
    expect(boxes).toMatch(/\.code-boxes-cells\s*\{\s*display:\s*none/);
  });

  it('marks the box being typed into with an outline, not by colour alone', () => {
    expect(boxes).toMatch(/\.code-box\[data-active="true"\]\s*\{[^}]*outline:\s*2px solid/);
  });
});

describe('the Add button on Documents (phone)', () => {
  it('takes the place of the header button on a phone, so the page keeps one filled primary', () => {
    expect(css).toMatch(
      /@media \(max-width: 760px\)\s*\{\s*\.docs-add-primary\s*\{\s*display:\s*none/,
    );
    expect(css).toMatch(/\.docs-add-fab\s*\{\s*display:\s*none;?\s*\}/);
  });

  it('is 56px tall, clear of the phone bar', () => {
    expect(css).toMatch(/\.docs-add-fab\s*\{[^}]*bottom:\s*calc\(5rem/);
    expect(css).toMatch(/\.docs-add-fab\s*\{[^}]*min-height:\s*56px/);
  });
});
