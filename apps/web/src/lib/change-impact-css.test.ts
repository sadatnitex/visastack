import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the "WP-CI What This Change Affects" stylesheet block: it is one marked block at the
 * end of the stylesheet, flat and on the shared tokens, every link and the fold keep a 44 pixel
 * target, nothing can push a phone screen wider, and every class the screens use is defined.
 */

const SRC = join(__dirname, '..');
const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
const MARKER = '/* WP-CI What This Change Affects */';

function block(): string {
  const start = css.indexOf(MARKER);
  if (start < 0) throw new Error(`stylesheet block "${MARKER}" is missing`);
  const rest = css.slice(start);
  const next = rest.slice(MARKER.length).search(/\n\/\* WP-/);
  return next < 0 ? rest : rest.slice(0, MARKER.length + next);
}

const ci = block();
const rule = (selector: string) =>
  ci.match(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`))?.[0];

describe('the What This Change Affects block', () => {
  it('is one block, marked on its own line and closed', () => {
    expect(css.split(MARKER)).toHaveLength(2);
    expect(css).toContain(`\n${MARKER}\n`);
    expect(ci.trimEnd().endsWith('/* end WP-CI */')).toBe(true);
  });

  it('gives every link, the fold and the retry a 44 pixel target', () => {
    for (const selector of ['.ci-step', '.ci-fold-summary', '.ci-retry']) {
      expect(rule(selector), selector).toContain('min-height: 44px');
    }
  });

  it('stays flat and colours only through tokens', () => {
    const rules = ci.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(
      /gradient|box-shadow|text-shadow|backdrop-filter|opacity|rgba?\(|hsla?\(/,
    );
    for (const line of rules.split('\n')) {
      if (/^\s*(color|background|border(-[a-z]+)?):/.test(line) && !/:\s*0;/.test(line)) {
        expect(line, line).toMatch(/var\(--[a-z0-9-]+\)/);
        expect(line, line).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      }
    }
  });

  it('lets nothing push the page wider than a phone screen', () => {
    for (const selector of ['.ci-review', '.ci-notice']) {
      expect(rule(selector), selector).toContain('min-width: 0');
      expect(rule(selector), selector).toContain('overflow-wrap: anywhere');
    }
    expect(rule('.ci-item')).toContain('min-width: 0');
    expect(ci).not.toMatch(/white-space:\s*nowrap|\bwidth:\s*\d+px/);
  });

  it('defines every class the screens use', () => {
    const dir = join(SRC, 'app', 'app', 'applicant', '[id]', 'change-impact');
    const used = new Set(
      readdirSync(dir)
        .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
        .flatMap((name) => readFileSync(join(dir, name), 'utf8').match(/\bci-[a-z-]+/g) ?? []),
    );
    expect(used.size).toBeGreaterThan(15);
    for (const name of used) expect(ci, name).toMatch(new RegExp(`\\.${name}\\b`));
  });
});
