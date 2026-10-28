import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast } from './agency-brand';

// Reads the live colour tokens from the stylesheet, so this cannot drift from what ships.
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const token = (name: string): string => {
  const match = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`token --${name} missing or not a six-digit colour`);
  return match[1];
};

// WCAG 2.2 AA: 4.5:1 for text, 3:1 for focus indicators and large text.
const TEXT = 4.5;

describe('the Harbor palette keeps text readable (WCAG AA)', () => {
  it.each([
    ['text', 'bg'],
    ['text', 'bg-elevated'],
    ['text', 'bg-subtle'],
    ['text', 'workspace-bg'],
    ['text', 'sidebar-bg'],
    ['text-secondary', 'bg'],
    ['text-secondary', 'bg-elevated'],
    ['text-secondary', 'workspace-bg'],
    ['text-tertiary', 'bg'],
    ['text-tertiary', 'bg-elevated'],
    ['text-tertiary', 'bg-subtle'],
    ['text-tertiary', 'sidebar-bg'],
    ['text-tertiary', 'workspace-bg'],
    ['text-secondary', 'bg-subtle'],
    ['text-secondary', 'sidebar-bg'],
    ['accent', 'bg'],
    ['accent', 'bg-elevated'],
    ['accent', 'brand-bg'],
    ['selected-text', 'brand-bg'],
    ['selected-text', 'brand-tint-3'],
    ['text-tertiary', 'brand-tint-3'],
    ['accent', 'brand-tint-1'],
    ['accent', 'brand-tint-2'],
    ['accent', 'brand-tint-4'],
    ['success', 'success-bg'],
    ['warning', 'warning-bg'],
    ['danger', 'danger-bg'],
    ['chapter-text', 'chapter-bg'],
    ['brand-tint-5', 'chapter-bg'],
  ])('%s on %s', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(TEXT);
  });

  it('keeps white readable on the action colour, its hover and the dark chapter', () => {
    for (const bg of ['accent', 'accent-hover', 'danger-strong', 'chapter-bg']) {
      expect(contrast('#ffffff', token(bg)), bg).toBeGreaterThanOrEqual(TEXT);
    }
    // The danger button's hover fill is a literal, darker than danger-strong.
    expect(css).toMatch(/\.btn-danger:hover \{[^}]*background: #8d2836;/);
    expect(contrast('#ffffff', '#8d2836')).toBeGreaterThanOrEqual(TEXT);
  });

  it('keeps the focus ring visible on white and on the page ground', () => {
    for (const bg of ['bg-elevated', 'bg']) {
      expect(contrast(token('accent'), token(bg)), bg).toBeGreaterThanOrEqual(3);
    }
  });

  it('never puts the action blue on the dark chapter, where it fails', () => {
    expect(contrast(token('accent'), token('chapter-bg'))).toBeLessThan(3);
    expect(css).not.toMatch(/\.auth-introduction[^{]*\{[^}]*color: var\(--accent\)/);
  });
});

describe('surfaces stay separable (WP-C2)', () => {
  it.each([
    ['sidebar-bg', 'workspace-bg', 1.15, 'the sidebar must read as its own zone beside the page'],
    ['bg-elevated', 'sidebar-bg', 1.2, 'a white pill or card must stand out on the sidebar'],
    ['edge-card', 'workspace-bg', 1.25, 'a card edge must show on the page'],
    ['edge-card', 'bg-elevated', 1.3, 'a card edge must show on white'],
    ['edge-control', 'bg-elevated', 3, 'a control or floating layer edge must meet 3:1 on white'],
    ['edge-control', 'workspace-bg', 3, 'a control or floating layer edge must meet 3:1 on the page'],
    ['text-secondary', 'text-tertiary', 1.3, 'body and meta text must look like two tiers'],
    ['text', 'text-secondary', 1.5, 'headings and body text must look like two tiers'],
  ])('%s against %s', (a, b, minimum, words) => {
    expect(contrast(token(a), token(b)), words).toBeGreaterThanOrEqual(minimum);
  });
});
