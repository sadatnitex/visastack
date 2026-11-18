import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { EFFECTS_EXCEPTIONS, checkStylesheet } from '../../../../../scripts/check-flat-design.mjs';

/**
 * Guards for the public site's shared parts (WP-PUB1, ADR 0029). Each one is shown failing on a
 * bad example, so a broken guard cannot pass quietly.
 */

const HERE = __dirname;
const GLOBALS = readFileSync(join(HERE, '..', '..', 'app', 'globals.css'), 'utf8');
const SITE = readFileSync(join(HERE, 'public-site.css'), 'utf8');
const SCENES = readFileSync(join(HERE, 'public-scenes.css'), 'utf8');
const SITE_PATH = 'apps/web/src/components/public-site/public-site.css';
const SCENES_PATH = 'apps/web/src/components/public-site/public-scenes.css';
const FILES = readdirSync(HERE, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => ({
    name: join(entry.parentPath, entry.name).slice(HERE.length + 1),
    text: readFileSync(join(entry.parentPath, entry.name), 'utf8'),
  }));

/** The first :root block of globals.css: the product's own colour tokens. */
function rootTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const root = postcss
    .parse(css)
    .nodes.find((node): node is Rule => node.type === 'rule' && node.selector === ':root');
  root?.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) tokens.set(decl.prop, decl.value.trim());
  });
  return tokens;
}

/** The custom properties set by the rules that list exactly this selector. */
function blockOf(css: string, selector: string): Map<string, string> {
  const found = new Map<string, string>();
  postcss.parse(css).walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) found.set(decl.prop, decl.value.trim());
    });
  });
  return found;
}

/** A value down to its #rrggbb colour, following var() through the given scopes. */
function resolve(value: string, ...scopes: Map<string, string>[]): string {
  let current = value;
  for (let hops = 0; hops < 8; hops++) {
    const name = /^var\(\s*(--[\w-]+)\s*\)$/.exec(current)?.[1];
    if (!name) break;
    const next = scopes.map((scope) => scope.get(name)).find(Boolean);
    if (!next) throw new Error(`unknown token ${name}`);
    current = next;
  }
  if (!/^#[0-9a-f]{6}$/i.test(current))
    throw new Error(`not a plain colour: ${value} -> ${current}`);
  return current;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TOKENS = rootTokens(GLOBALS);
const TONES = {
  light: blockOf(SITE, '.pub-chapter-light'),
  dark: blockOf(SITE, '.pub-chapter-dark'),
};
const CHIPS = [
  'received',
  'reviewed',
  'suggested',
  'confirmed',
  'saved',
  'shared',
  'access-ended',
].map((name) => ({ name, block: blockOf(SITE, `.pub-chip-${name}`) }));

/** Every text colour a chapter uses, against its canvas. */
const TEXT_ON_CANVAS = [
  '--pub-ink',
  '--pub-ink-soft',
  '--pub-accent',
  '--pub-words-from',
  '--pub-words-to',
];

describe('contrast on the public site', () => {
  it('reads the product tokens it relies on', () => {
    expect(TOKENS.get('--text')).toBe('#13243d');
    expect(TOKENS.get('--accent')).toBe('#1d4c98');
    expect(TOKENS.get('--chapter-bg')).toBe('#0b1a30');
  });

  for (const [tone, block] of Object.entries(TONES)) {
    it(`keeps every text on a ${tone} chapter at 4.5:1 or more`, () => {
      const canvas = resolve(block.get('--pub-canvas') ?? '', block, TOKENS);
      for (const name of TEXT_ON_CANVAS) {
        const value = block.get(name);
        expect(value, `${tone} ${name}`).toBeDefined();
        const ratio = contrast(resolve(value ?? '', block, TOKENS), canvas);
        expect(ratio, `${tone} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
      // A card sits on the chapter; its words keep the same bar.
      const card = resolve(block.get('--pub-card') ?? '', block, TOKENS);
      for (const name of ['--pub-ink', '--pub-ink-soft'])
        expect(
          contrast(resolve(block.get(name) ?? '', block, TOKENS), card),
        ).toBeGreaterThanOrEqual(4.5);
      // Button words on the button, and the button's edge against the chapter (3:1 for a control).
      const button = resolve(block.get('--pub-button') ?? '', block, TOKENS);
      expect(
        contrast(resolve(block.get('--pub-button-ink') ?? '', block, TOKENS), button),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(resolve(block.get('--pub-edge-strong') ?? '', block, TOKENS), canvas),
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(resolve(block.get('--pub-focus') ?? '', block, TOKENS), canvas),
      ).toBeGreaterThanOrEqual(3);
    });
  }

  it('keeps every chip word at 4.5:1 and every chip visible at 3:1 on both chapters', () => {
    for (const { name, block } of CHIPS) {
      expect(block.size, name).toBe(3);
      const fg = resolve(block.get('--chip-fg') ?? '', TOKENS);
      const bg = resolve(block.get('--chip-bg') ?? '', TOKENS);
      const edge = resolve(block.get('--chip-edge') ?? '', TOKENS);
      expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(4.5);
      for (const [tone, scope] of Object.entries(TONES)) {
        const canvas = resolve(scope.get('--pub-canvas') ?? '', scope, TOKENS);
        expect(
          Math.max(contrast(bg, canvas), contrast(edge, canvas)),
          `${name} on ${tone}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('catches a pair that falls short', () => {
    expect(contrast('#7f8faa', '#f7f9fe')).toBeLessThan(4.5);
    expect(() => resolve('var(--missing)', TOKENS)).toThrow();
    expect(() => resolve('rgb(0 0 0)', TOKENS)).toThrow();
  });
});

/** Every use of a tone token outside the tone blocks, with the fallback it names (or none). */
function toneUses(css: string): { name: string; fallback: string | null }[] {
  const uses: { name: string; fallback: string | null }[] = [];
  postcss.parse(css).walkDecls((decl) => {
    const rule = decl.parent as Rule;
    if (rule.selector === '.pub-chapter-light' || rule.selector === '.pub-chapter-dark') return;
    for (const match of decl.value.matchAll(
      /var\(\s*(--pub-[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))+))?\)/g,
    )) {
      const name = match[1] ?? '';
      if (TONES.light.has(name)) uses.push({ name, fallback: match[2]?.trim() ?? null });
    }
  });
  return uses;
}

describe('parts outside a chapter', () => {
  it('fall back to the light tone at every use, and no page inherits the tone names', () => {
    expect(TONES.light.size).toBe(12);
    expect(TONES.dark.size).toBe(12);
    const uses = [...toneUses(SITE), ...toneUses(SCENES)];
    expect(uses.length).toBeGreaterThan(15);
    for (const { name, fallback } of uses) expect(fallback, name).toBe(TONES.light.get(name));
    expect(/(^|[\s,}]):root\b/.test(SITE)).toBe(false);
  });
  it('catches a use without the light fallback', () => {
    expect(toneUses('.x { color: var(--pub-ink) }')).toEqual([
      { name: '--pub-ink', fallback: null },
    ]);
  });
});

describe('public site sources', () => {
  const INLINE_PICTURE = /\b(?:data|blob):/i;
  it('never use an inline data: or blob: picture (img-src self)', () => {
    for (const file of FILES.filter(
      (f) => /\.(?:css|tsx?)$/.test(f.name) && !f.name.includes('.test.'),
    ))
      expect(INLINE_PICTURE.test(file.text), file.name).toBe(false);
    expect(INLINE_PICTURE.test('background: url(data:image/png;base64,AA)')).toBe(true);
  });

  it('carry no em dash anywhere', () => {
    const dash = String.fromCodePoint(0x2014);
    for (const file of FILES) expect(file.text.includes(dash), file.name).toBe(false);
  });

  it('name no colour outside the product tokens (no new hue)', () => {
    const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\(/i;
    for (const [name, css] of [
      ['public-site.css', SITE],
      ['public-scenes.css', SCENES],
      ['kit/kit.css', readFileSync(join(HERE, 'kit', 'kit.css'), 'utf8')],
      ['kit/kit-steps.css', readFileSync(join(HERE, 'kit', 'kit-steps.css'), 'utf8')],
    ] as const) {
      postcss.parse(css).walkDecls((decl) => {
        expect(LITERAL.test(decl.value), `${name}: ${decl.prop}: ${decl.value}`).toBe(false);
      });
    }
    expect(LITERAL.test('color-mix(in srgb, #5ad1ff 40%, white)')).toBe(true);
  });

  it('start every block of the flat stylesheet with a WP-PUB1 marker', () => {
    expect(SITE.startsWith('/* WP-PUB1 ')).toBe(true);
    const markers = SITE.split('\n').filter((line) => line.startsWith('/* WP-'));
    expect(markers.length).toBeGreaterThan(5);
    for (const marker of markers) expect(marker.startsWith('/* WP-PUB')).toBe(true);
  });

  it('keep the flat stylesheet flat (it is not on the exception list)', () => {
    expect(checkStylesheet(SITE, SITE_PATH)).toEqual([]);
    expect(checkStylesheet(`${SITE}\n.x { box-shadow: 0 1px 2px #000 }`, SITE_PATH).length).toBe(1);
  });
});

/** Every rule of a stylesheet, with the media queries it sits in. */
function rulesOf(css: string): { rule: Rule; media: string[] }[] {
  const found: { rule: Rule; media: string[] }[] = [];
  postcss.parse(css).walkRules((rule) => {
    const media: string[] = [];
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'atrule' && (parent as AtRule).name === 'media')
        media.push((parent as AtRule).params);
    }
    found.push({ rule, media });
  });
  return found;
}

/** Reasons a depth stylesheet breaks the rules of ADR 0029. */
/** The last compound of a selector (after the last combinator), with :not(...) groups removed. */
function lastCompound(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(ch ?? '')) start = i + 1;
  }
  let last = selector.slice(start);
  for (;;) {
    const at = last.indexOf(':not(');
    if (at === -1) break;
    let level = 0;
    let end = at + 4;
    for (; end < last.length; end++) {
      if (last[end] === '(') level += 1;
      if (last[end] === ')' && --level === 0) break;
    }
    last = last.slice(0, at) + last.slice(end + 1);
  }
  return last;
}

function depthProblems(css: string): string[] {
  const problems: string[] = [];
  postcss.parse(css).walkAtRules('media', (rule) => {
    if (/prefers-color-scheme\s*:\s*dark/i.test(rule.params)) problems.push('dark appearance');
  });
  for (const { rule, media } of rulesOf(css)) {
    for (const selector of rule.selectors)
      if (!lastCompound(selector).includes('[data-pub-depth]'))
        problems.push(`unscoped: ${selector}`);
    rule.each((node) => {
      if (node.type !== 'decl') return;
      const { prop } = node as Declaration;
      const moving =
        /^(?:transform|translate|rotate|scale|opacity|transition.*|animation.*|will-change)$/.test(
          prop,
        );
      if (!moving) return;
      if (/^(?:transition|animation)/.test(prop)) problems.push(`timed motion: ${prop}`);
      const calm = media.some((q) => /prefers-reduced-motion\s*:\s*no-preference/.test(q));
      const live = rule.selectors.every(
        (s) => s.includes('html[data-scenes="live"]') && s.includes(':not([data-save-data])'),
      );
      if (!calm || !live) problems.push(`motion outside the live, calm scope: ${rule.selector}`);
    });
  }
  return problems;
}

describe('the one depth stylesheet (ADR 0029)', () => {
  it('is the third and last entry of the flat-design exception list', () => {
    expect(EFFECTS_EXCEPTIONS).toContain(SCENES_PATH);
    expect(EFFECTS_EXCEPTIONS).not.toContain(SITE_PATH);
    expect(checkStylesheet(SCENES, SCENES_PATH)).toEqual([]);
  });

  it('keeps depth scoped, moves only with the engine, and only when motion is welcome', () => {
    expect(depthProblems(SCENES)).toEqual([]);
  });

  it('fails each rule on a bad example', () => {
    expect(depthProblems('.card { box-shadow: 0 1px 2px var(--text) }')).toEqual([
      'unscoped: .card',
    ]);
    expect(depthProblems('.x:not([data-pub-depth]) { box-shadow: 0 1px 2px var(--text) }')).toEqual(
      ['unscoped: .x:not([data-pub-depth])'],
    );
    expect(depthProblems('[data-pub-depth] .card { box-shadow: 0 1px 2px var(--text) }')).toEqual([
      'unscoped: [data-pub-depth] .card',
    ]);
    expect(depthProblems('.a[data-pub-depth] > .card[data-pub-depth] { opacity: 1 }')[0]).toMatch(
      /motion outside/,
    );
    expect(depthProblems('.x[data-pub-depth] { transform: scale(2) }')[0]).toMatch(
      /motion outside/,
    );
    expect(
      depthProblems(
        '@media (prefers-reduced-motion: no-preference) { html[data-scenes="live"] [data-pub-depth] { opacity: 0 } }',
      )[0],
    ).toMatch(/motion outside/);
    expect(
      depthProblems(
        '@media (prefers-reduced-motion: no-preference) { html[data-scenes="live"]:not([data-save-data]) [data-pub-depth] { transition: opacity 1s } }',
      ),
    ).toEqual(['timed motion: transition']);
    expect(
      depthProblems(
        '@media (prefers-color-scheme: dark) { [data-pub-depth] { color: var(--text) } }',
      ),
    ).toEqual(['dark appearance']);
  });
});

describe('flag places', () => {
  it('give every flag a place and every ring size a count, up to the ring maximum', () => {
    for (let i = 0; i < 12; i++)
      expect(SITE).toContain(`.pub-flag-ring-list li:nth-child(${i + 1}) {\n  --i: ${i};\n}`);
    for (let n = 1; n <= 12; n++)
      expect(SITE).toContain(`.pub-flag-ring-list[data-count="${n}"] {\n  --n: ${n};\n}`);
  });
});
