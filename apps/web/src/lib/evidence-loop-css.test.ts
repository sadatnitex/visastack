import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the "WP-LANE-E evidence loop" stylesheet block: the choice of copy to send, Upload a
 * Clearer Copy and the agency's exact copy card. Every control keeps a 44 pixel target, nothing is
 * coloured except through the shared tokens, and every class the new screens use is defined.
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

const lane = block('/* WP-LANE-E evidence loop');
const rule = (selector: string) =>
  lane.match(new RegExp(`\\n${selector.replace(/\./g, '\\.')} \\{[^}]*\\}`))?.[0];

describe('the evidence loop block', () => {
  it('gives every control and toggle a 44 pixel target', () => {
    for (const selector of [
      '.evidence-clearer-toggle',
      '.evidence-earlier-toggle',
      '.evidence-add-link',
      '.evidence-copy-button',
      '.request-decision-button',
      '.request-decision-refresh',
    ]) {
      expect(rule(selector), selector).toBeDefined();
      expect(rule(selector), selector).toContain('min-height: 44px');
    }
    expect(lane).toMatch(/\.request-decision-reason \.input \{[^}]*min-height: 44px/);
  });

  it('keeps the copy to send as a 44 pixel row, in the original request block', () => {
    const original = css.slice(css.indexOf('/* WP-V4 request screens'));
    expect(original).toMatch(/\n\.request-choice \{[^}]*min-height: 44px/);
  });

  it('stays flat and colours text and borders only through tokens', () => {
    const rules = lane.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(rules).not.toMatch(
      /gradient|box-shadow|text-shadow|drop-shadow|backdrop|filter|opacity/,
    );
    for (const line of rules.split('\n')) {
      if (/^\s*(color|background|border(-left)?(-color)?)\s*:/.test(line)) {
        if (/:\s*(0|none|transparent)\s*;/.test(line)) continue;
        // The one filled action keeps the white text the shared primary button uses.
        if (/^\s*color:\s*#fff;/.test(line)) continue;
        expect(line, line).toMatch(/var\(--[a-z0-9-]+\)/);
      }
    }
  });

  it('shows the focus ring on the heading focus returns to and on the toggles', () => {
    expect(lane).toMatch(/\.evidence-pick-legend:focus-visible \{[^}]*outline: 2px solid/);
    expect(lane).toMatch(/\.evidence-clearer-toggle:focus-visible \{[^}]*outline: 2px solid/);
  });

  it('lets nothing push the page wider than the screen', () => {
    for (const selector of ['.evidence-pick-text', '.evidence-copies', '.evidence-copy']) {
      expect(rule(selector), selector).toContain('min-width: 0');
    }
    expect(rule('.evidence-copy-name')).toContain('overflow-wrap: anywhere');
    expect(rule('.evidence-copy-meta')).toContain('overflow-wrap: anywhere');
  });

  it('defines every class the new screens use', () => {
    const files = [
      'app/app/applicant/[id]/evidence/submit-response-form.tsx',
      'app/app/applicant/[id]/evidence/clearer-copy-panel.tsx',
      'app/app/applicant/[id]/evidence/page.tsx',
      'app/app/agency/[orgId]/evidence-copies.tsx',
      'app/app/agency/[orgId]/evidence-request-actions.tsx',
      'app/app/agency/[orgId]/clients/page.tsx',
    ];
    const used = new Set<string>();
    for (const file of files) {
      const source = readFileSync(join(SRC, file), 'utf8');
      // Only what is written as a class: className="..." and className={`...`}.
      for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const text = (match[1] ?? match[2] ?? '').replace(/\$\{[^}]*\}/g, ' ');
        for (const name of text.split(/\s+/)) {
          if (/^(evidence-|request-decision|request-row)/.test(name)) used.add(name);
        }
      }
    }
    expect(used.size).toBeGreaterThan(10);
    const missing = [...used].filter((name) => !new RegExp(`\\.${name}(?![a-z-])`).test(css));
    expect(missing).toEqual([]);
  });

  it('writes none of its classes in the older request block', () => {
    const outside = css.replace(lane, '');
    expect(outside).not.toMatch(
      /\.(evidence-pick|evidence-clearer|evidence-copy|evidence-earlier)/,
    );
  });
});
