import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from './agency-brand';

/**
 * Guards for the "WP-V4 request screens" stylesheet block: every class the request screens use is
 * defined there, it stays inside the flat design and the shared tokens, and the colours it puts on
 * text are readable on the surface they sit on.
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

const request = block('/* WP-V4 request screens');

const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const token = (name: string): string => {
  const match = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`token --${name} missing`);
  return match[1];
};

describe('the request screens block stays flat and on the shared tokens', () => {
  it('has no literal colour, gradient, shadow, translucency or blur', () => {
    const rules = request.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(rules).not.toMatch(
      /gradient|box-shadow|text-shadow|drop-shadow|backdrop|filter|opacity/,
    );
  });

  it('colours text and borders only through tokens', () => {
    const rules = request.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const line of rules.split('\n')) {
      if (/^\s*(color|background|border(-left)?(-color)?)\s*:/.test(line)) {
        // Removing a border (0 or none) is not a colour; every colour is a token.
        if (!/:\s*(0|none)\s*;/.test(line)) expect(line, line).toMatch(/var\(--[a-z0-9-]+\)/);
      }
    }
  });

  it('gives every control and link a 44 pixel target', () => {
    for (const selector of ['.request-choice', '.request-ask-toggle', '.request-questions-link']) {
      const rule = request.match(new RegExp(`\\n${selector.replace('.', '\\.')} \\{[^}]*\\}`))?.[0];
      expect(rule, selector).toBeDefined();
      expect(rule, selector).toContain('min-height: 44px');
    }
  });

  it('lets nothing push the page wider than the screen', () => {
    for (const selector of [
      '.request-response',
      '.request-ask',
      '.request-ask-form',
      '.request-questions',
    ]) {
      const rule = request.match(new RegExp(`\\n${selector.replace('.', '\\.')} \\{[^}]*\\}`))?.[0];
      expect(rule, selector).toContain('min-width: 0');
    }
    expect(request).toMatch(/\.request-question-text \{[^}]*overflow-wrap: anywhere/);
  });
});

describe('every class the request screens use is defined', () => {
  const files = [
    'app/app/applicant/[id]/evidence/page.tsx',
    'app/app/applicant/[id]/evidence/submit-response-form.tsx',
    'app/app/applicant/[id]/evidence/ask-about-item-form.tsx',
    'app/app/agency/[orgId]/case-triage-summary.tsx',
  ];

  it('defines each request-* class, and each triage tone class, in the block', () => {
    const used = new Set<string>();
    for (const file of files) {
      const source = readFileSync(join(SRC, file), 'utf8');
      for (const match of source.matchAll(/\brequest-[a-z-]+\b/g)) used.add(match[0]);
    }
    // Tone classes are built from the colour family at run time.
    for (const tone of ['warning', 'success']) used.add(`request-item-${tone}`);
    const defined = new Set([...request.matchAll(/\.(request-[a-z-]+)\b/g)].map((m) => m[1]));
    const missing = [...used].filter((name) => !defined.has(name) && !name.endsWith('-'));
    expect(missing).toEqual([]);
    for (const tone of ['warning', 'success', 'neutral']) {
      expect(request).toContain(`.case-triage-group-${tone}`);
    }
  });

  it('keeps the page source free of inline styles for these screens', () => {
    for (const file of files.slice(0, 3)) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).not.toContain('style={{');
    }
  });

  it('is the only place the request-* classes are written', () => {
    const outside = css.replace(request, '');
    expect(outside).not.toMatch(/\.request-(item|response|choice|ask|questions?)\b/);
  });
});

describe('colours put on text by this block are readable', () => {
  it.each([
    ['warning', 'bg-elevated'],
    ['danger', 'bg-elevated'],
    ['selected-text', 'bg-elevated'],
    ['success', 'bg-elevated'],
    ['text-secondary', 'bg-subtle'],
    ['warning', 'warning-bg'],
    ['success', 'success-bg'],
  ])('%s on %s reaches 4.5 to 1', (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });
});
