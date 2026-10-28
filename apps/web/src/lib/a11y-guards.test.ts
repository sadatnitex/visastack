import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');

function tokens(): Record<string, string> {
  const start = css.indexOf(':root {');
  const block = css.slice(start, css.indexOf('\n}', start));
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    found[match[1] as string] = match[2] as string;
  }
  return found;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('text colours stay readable', () => {
  const t = tokens();
  const PAIRS: readonly (readonly [string, string])[] = [
    ['text', 'bg'],
    ['text-secondary', 'bg'],
    ['text-tertiary', 'bg'],
    ['text-tertiary', 'bg-elevated'],
    ['text-tertiary', 'bg-subtle'],
    ['accent', 'bg-elevated'],
    ['bg-elevated', 'accent-strong'],
    ['bg-elevated', 'danger-strong'],
    ['success', 'success-bg'],
    ['warning', 'warning-bg'],
    ['danger', 'danger-bg'],
    ['selected-text', 'brand-bg'],
  ];
  for (const [foreground, background] of PAIRS) {
    it(`${foreground} on ${background} reaches 4.5 to 1`, () => {
      expect(t[foreground], foreground).toBeDefined();
      expect(t[background], background).toBeDefined();
      expect(contrast(t[foreground] as string, t[background] as string)).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
});

it('every button keeps a 44 pixel tap height', () => {
  const rule = css.match(/\n\.btn \{[^}]*\}/)?.[0] ?? '';
  expect(rule).toMatch(/min-height:\s*44px/);
});

describe('what a button says matches what it shows', () => {
  it('has no button or link whose spoken name leaves out its visible words', () => {
    const misses: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test')) scan(full);
      }
    };
    const scan = (file: string) => {
      const source = readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node)) {
          const open = node.openingElement;
          if (['a', 'button', 'Link', 'summary'].includes(open.tagName.getText(sf))) {
            const attribute = open.attributes.properties.find(
              (a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'aria-label',
            );
            if (
              attribute &&
              ts.isJsxAttribute(attribute) &&
              attribute.initializer &&
              ts.isStringLiteral(attribute.initializer)
            ) {
              const visible = node.children
                .filter((c): c is ts.JsxText => ts.isJsxText(c))
                .map((c) => c.text)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
              if (
                visible &&
                !attribute.initializer.text.toLowerCase().includes(visible.toLowerCase())
              ) {
                misses.push(`${file}: "${attribute.initializer.text}" vs "${visible}"`);
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    };
    walk(SRC);
    expect(misses).toEqual([]);
  });
});

describe('motion stays on the shared speeds', () => {
  it('defines three speeds and one curve, and no transition writes its own', () => {
    const t = css.match(/--motion-(press|state|arrive|ease):/g) ?? [];
    expect(t).toHaveLength(4);
    const own = css
      .split('\n')
      .filter((line) => /^\s*transition:/.test(line) && /\b\d*\.?\d+m?s\b/.test(line));
    expect(own).toEqual([]);
  });

  it('turns every transition and animation off for visitors who ask for less motion', () => {
    // Pseudo-elements are not matched by * alone: the disclosure arrow turns through ::after.
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*(?:\/\*[^*]*\*\/\s*)?\*,\s*\*::before,\s*\*::after \{\s*animation: none !important;\s*transition: none !important;/,
    );
  });
});
