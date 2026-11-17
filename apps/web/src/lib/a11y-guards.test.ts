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

// ADR 0027 (owner decision D2, 17 Nov 2026): one slow speed for gentle picture and hero motion.
describe('the slow picture speed is defined once and only ever moves for people who allow motion', () => {
  function sourceFiles(directory: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) found.push(...sourceFiles(full));
      else found.push(full);
    }
    return found;
  }
  const withoutComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const files = sourceFiles(SRC);
  const stylesheets = files
    .filter((file) => file.endsWith('.css'))
    .map((file) => ({
      file: file.slice(SRC.length),
      text: withoutComments(readFileSync(file, 'utf8')),
    }));

  type SlowUse = { chain: string[]; alias: boolean };
  // var( --motion-slow ) in any letter case, never the longer name --motion-slower.
  const SLOW_VAR = /var\(\s*--motion-slow\s*[,)]/iy;
  // For each use of var(--motion-slow): the at-rule preludes around it, and whether it only
  // hands the speed on to another custom property (which would carry it past the gate).
  function slowUses(source: string): SlowUse[] {
    const uses: SlowUse[] = [];
    const stack: string[] = [];
    let start = 0;
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') {
        stack.push(source.slice(start, i).trim());
        start = i + 1;
      } else if (ch === '}') {
        stack.pop();
        start = i + 1;
      } else if (ch === ';') {
        start = i + 1;
      } else if (ch === 'v' || ch === 'V') {
        SLOW_VAR.lastIndex = i;
        if (!SLOW_VAR.test(source)) continue;
        uses.push({
          chain: stack.filter((prelude) => prelude.startsWith('@')),
          alias: /^--[\w-]+\s*:/.test(source.slice(start, i).trim()),
        });
      }
    }
    return uses;
  }
  // Gated means a media rule whose every comma-separated query (a comma means "or") is a plain
  // "and" list that asks for prefers-reduced-motion: no-preference, with no "not" and no "or".
  const gates = (prelude: string) =>
    /^@media\s/i.test(prelude) &&
    prelude
      .replace(/^@media\s+/i, '')
      .split(',')
      .every(
        (query) =>
          /\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/i.test(query) &&
          !/(?:^|[\s(])(?:not|or)(?=[\s(])/i.test(query),
      );
  const gated = (use: SlowUse) => !use.alias && use.chain.some(gates);

  it('defines --motion-slow exactly once, as a calm speed of at most 700ms', () => {
    const definitions = [...css.matchAll(/--motion-slow:\s*(\d+)ms;/g)];
    expect(definitions).toHaveLength(1);
    expect(withoutComments(css).match(/--motion-slow\s*:/g) ?? []).toHaveLength(1);
    const everywhere = stylesheets.flatMap(({ text }) => text.match(/--motion-slow\s*:/g) ?? []);
    expect(everywhere).toHaveLength(1);
    const ms = Number(definitions[0]?.[1]);
    expect(ms).toBeGreaterThan(320);
    expect(ms).toBeLessThanOrEqual(700);
  });

  it('uses var(--motion-slow) only inside a prefers-reduced-motion: no-preference block', () => {
    const misses = stylesheets.flatMap(({ file, text }) =>
      slowUses(text)
        .filter((use) => !gated(use))
        .map(() => file),
    );
    expect(misses).toEqual([]);
  });

  const componentCode = (file: string) =>
    /\.(?:ts|tsx|js|jsx|mjs)$/.test(file) && !/\.test\.[cm]?[jt]sx?$/.test(file);
  const namesSlow = (text: string) => /--motion-slow(?![\w-])/.test(text);

  it('never reaches the slow speed from component code, where no media query can gate it', () => {
    const misses = files
      .filter(componentCode)
      .filter((file) => namesSlow(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length));
    expect(misses).toEqual([]);
  });

  it('the guard itself tells a gated use from an ungated one', () => {
    const verdicts = (text: string) => slowUses(withoutComments(text)).map(gated);
    expect(
      verdicts(
        '/* var(--motion-slow) */ @media (prefers-reduced-motion: no-preference) { .a { transition: opacity var(--motion-slow) var(--motion-ease); } }',
      ),
    ).toEqual([true]);
    expect(
      verdicts(
        '@media (prefers-reduced-motion: no-preference) and (width > 40rem) { .a { animation-duration: var(--motion-slow); } }',
      ),
    ).toEqual([true]);
    expect(verdicts('.a { transition: opacity var(--motion-slow) var(--motion-ease); }')).toEqual([
      false,
    ]);
    expect(
      verdicts('@media (width > 40rem) { .a { animation-duration: var(--motion-slow); } }'),
    ).toEqual([false]);
    expect(
      verdicts(
        '@media (prefers-reduced-motion: no-preference), (min-width: 0) { .a { animation-duration: var(--motion-slow); } }',
      ),
    ).toEqual([false]);
    expect(
      verdicts(
        '@media (prefers-reduced-motion: no-preference) { :root { --hero-speed: var(--motion-slow); } }',
      ),
    ).toEqual([false]);
    for (const negated of [
      '@media not (prefers-reduced-motion: no-preference)',
      '@media (not (prefers-reduced-motion: no-preference))',
      '@media (prefers-reduced-motion: no-preference) or (min-width: 0)',
      '@media not all and (prefers-reduced-motion: no-preference)',
    ])
      expect(verdicts(`${negated} { .a { animation-duration: var(--motion-slow); } }`)).toEqual([
        false,
      ]);
    expect(
      verdicts(
        '.a { animation-duration: var( --motion-slow ); } .b { transition-duration: VAR(--motion-slow, 1s); }',
      ),
    ).toEqual([false, false]);
    expect(verdicts('.a { animation-duration: var(--motion-slower); }')).toEqual([]);
  });

  it('the component-code check reads every script kind and ignores longer names', () => {
    for (const file of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs'])
      expect(componentCode(`/src/x/${file}`)).toBe(true);
    expect(componentCode('/src/x/a.test.ts')).toBe(false);
    expect(componentCode('/src/x/a.css')).toBe(false);
    expect(namesSlow("const speed = 'var(--motion-slow)';")).toBe(true);
    expect(namesSlow("const speed = 'var(--motion-slower)';")).toBe(false);
  });
});
