import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type AtRule, type ChildNode, type Container, type Declaration } from 'postcss';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the one stylesheet where pictures may move and look raised (ADR 0027):
 * - motion animates transform and opacity only;
 * - durations are only the shared speeds;
 * - every animation and transition sits inside @media (prefers-reduced-motion: no-preference)
 *   and behind html:not([data-save-data]);
 * - a one-shot animation never holds its end state (it would block the hover lift);
 * - no automatic dark appearance;
 * - at most one moving hero per screen (no source file names the moving class twice).
 * Each guard is shown failing on a bad example, so a broken guard cannot pass quietly.
 */

const HERE = __dirname;
const SRC = join(HERE, '..', '..');
const SHEET = readFileSync(join(HERE, 'pictures-depth.css'), 'utf8');

const MOVING = new Set(['transform', 'opacity']);
const SHARED_SPEED = /^var\(\s*--motion-(?:press|state|arrive|slow)\s*\)$/;
const SHARED_EASE = /^var\(\s*--motion-ease\s*\)$/;
const TIME = /^-?\d*\.?\d+m?s$/i;
const MOTION_PROPS =
  /^(?:transition|transition-property|transition-duration|transition-delay|animation|animation-name|animation-duration|animation-delay|will-change)$/;

/** Splits a value on top-level commas (not the commas inside var() or other brackets). */
function splitTop(value: string, separator: ',' | ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth === 0 && (separator === ' ' ? /\s/.test(ch) : ch === separator)) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function ancestors(node: ChildNode): Container[] {
  const chain: Container[] = [];
  let parent = node.parent;
  while (parent && parent.type !== 'root') {
    chain.push(parent as Container);
    parent = parent.parent as Container | undefined;
  }
  return chain;
}

/** A media query that asks for no-preference in every comma-separated branch, with no "not". */
function asksForMotion(at: AtRule): boolean {
  if (at.name !== 'media') return false;
  return splitTop(at.params, ',').every(
    (query) =>
      /\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/i.test(query) &&
      !/\bnot\b/i.test(query),
  );
}

/** Every selector of the rule starts with the data saver gate. */
function behindDataSaver(selector: string): boolean {
  return splitTop(selector, ',').every((part) =>
    /^html:not\(\[data-save-data\]\)\s/.test(part.trim()),
  );
}

function durationsOk(value: string): string | null {
  for (const part of splitTop(value, ',')) {
    for (const token of splitTop(part, ' ')) {
      if (TIME.test(token) && Number.parseFloat(token) !== 0) return `raw time ${token}`;
      if (
        /^var\(/.test(token) &&
        /--motion-/.test(token) &&
        !SHARED_SPEED.test(token) &&
        !SHARED_EASE.test(token)
      )
        return `unknown speed ${token}`;
      if (/^calc\(/i.test(token)) return `computed time ${token}`;
    }
  }
  return null;
}

/** Problems in a picture stylesheet; empty when it keeps every rule. */
function checkPictureSheet(css: string): string[] {
  const errors: string[] = [];
  const root = postcss.parse(css);
  const keyframes = new Set<string>();

  root.walkAtRules((at) => {
    if (at.name === 'media' && /prefers-color-scheme/i.test(at.params))
      errors.push('automatic dark appearance');
    if (/^(?:-webkit-)?keyframes$/.test(at.name)) {
      keyframes.add(at.params.trim());
      at.walkDecls((decl) => {
        if (!MOVING.has(decl.prop)) errors.push(`keyframes ${at.params} animate ${decl.prop}`);
      });
    }
  });

  root.walkDecls((decl: Declaration) => {
    if (!MOTION_PROPS.test(decl.prop)) return;
    const chain = ancestors(decl);
    if (chain.some((node) => node.type === 'atrule' && /keyframes$/.test((node as AtRule).name)))
      return;
    const where = `${decl.prop}: ${decl.value}`;
    if (!chain.some((node) => node.type === 'atrule' && asksForMotion(node as AtRule)))
      errors.push(`not gated by reduced motion: ${where}`);
    const rule = chain.find((node) => node.type === 'rule') as { selector: string } | undefined;
    if (!rule || !behindDataSaver(rule.selector)) errors.push(`not gated by data saver: ${where}`);

    const value = decl.value.trim();
    if (decl.prop === 'transition' || decl.prop === 'animation') {
      const bad = durationsOk(value);
      if (bad) errors.push(`${bad}: ${where}`);
      for (const part of splitTop(value, ',')) {
        const tokens = splitTop(part, ' ');
        if (!tokens.some((token) => SHARED_SPEED.test(token)))
          errors.push(`no shared speed: ${where}`);
        if (decl.prop === 'transition' && !MOVING.has(tokens[0] ?? ''))
          errors.push(`transition moves ${tokens[0]}: ${where}`);
        if (decl.prop === 'animation') {
          // A held end state (both, forwards) would pin transform and block .pic-lift.
          if (tokens.some((token) => token === 'both' || token === 'forwards'))
            errors.push(`animation holds its end state: ${where}`);
          const name = tokens.find((token) => keyframes.has(token));
          if (!name) errors.push(`animation names no keyframes here: ${where}`);
        }
      }
    }
    if (decl.prop === 'transition-property' || decl.prop === 'will-change') {
      for (const name of splitTop(value, ',')) {
        if (!MOVING.has(name)) errors.push(`${decl.prop} names ${name}`);
      }
    }
    if (/-(?:duration|delay)$/.test(decl.prop)) {
      const bad = durationsOk(value);
      if (bad) errors.push(`${bad}: ${where}`);
      if (!splitTop(value, ',').every((token) => SHARED_SPEED.test(token)))
        errors.push(`not a shared speed: ${where}`);
    }
  });
  return errors;
}

const GOOD_MOTION = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes k { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  html:not([data-save-data]) .a { animation: k var(--motion-slow) var(--motion-ease) backwards; }
  html:not([data-save-data]) .b { transition: transform var(--motion-state) var(--motion-ease), opacity var(--motion-press) var(--motion-ease); }
}`;

describe('pictures-depth.css keeps the motion rules', () => {
  it('passes every guard as written', () => {
    expect(checkPictureSheet(SHEET)).toEqual([]);
  });

  it('really has motion to guard, every piece of it gated', () => {
    const root = postcss.parse(SHEET);
    let moving = 0;
    root.walkDecls(/^(?:animation|transition)$/, () => {
      moving += 1;
    });
    expect(moving).toBeGreaterThanOrEqual(2);
    expect(SHEET).toMatch(/@keyframes pic-float-in/);
  });

  it('passes a good example, so the guard is not simply refusing everything', () => {
    expect(checkPictureSheet(GOOD_MOTION)).toEqual([]);
  });

  it.each([
    [
      'a transition of size',
      '@media (prefers-reduced-motion: no-preference) { html:not([data-save-data]) .a { transition: width var(--motion-state) ease; } }',
      'transition moves width',
    ],
    [
      'a transition of everything',
      '@media (prefers-reduced-motion: no-preference) { html:not([data-save-data]) .a { transition: all var(--motion-state) ease; } }',
      'transition moves all',
    ],
    [
      'keyframes that change colour',
      '@media (prefers-reduced-motion: no-preference) { @keyframes k { to { background-color: red; } } html:not([data-save-data]) .a { animation: k var(--motion-slow) ease; } }',
      'keyframes k animate background-color',
    ],
    [
      'keyframes that change a shadow',
      '@media (prefers-reduced-motion: no-preference) { @keyframes k { to { box-shadow: 0 0 4px red; } } html:not([data-save-data]) .a { animation: k var(--motion-slow) ease; } }',
      'keyframes k animate box-shadow',
    ],
    [
      'an animation that holds its end state',
      '@media (prefers-reduced-motion: no-preference) { @keyframes k { to { opacity: 1; } } html:not([data-save-data]) .a { animation: k var(--motion-slow) ease forwards; } }',
      'animation holds its end state',
    ],
    [
      'a raw time',
      '@media (prefers-reduced-motion: no-preference) { html:not([data-save-data]) .a { transition: transform 300ms ease; } }',
      'raw time 300ms',
    ],
    [
      'a time in seconds',
      '@media (prefers-reduced-motion: no-preference) { @keyframes k { to { opacity: 1; } } html:not([data-save-data]) .a { animation: k 2s ease infinite; } }',
      'raw time 2s',
    ],
    [
      'a speed that is not shared',
      '@media (prefers-reduced-motion: no-preference) { html:not([data-save-data]) .a { transition: transform var(--motion-glacial) ease; } }',
      'unknown speed var(--motion-glacial)',
    ],
    [
      'a computed speed',
      '@media (prefers-reduced-motion: no-preference) { html:not([data-save-data]) .a { transition: transform calc(var(--motion-slow) * 4) ease; } }',
      'computed time',
    ],
    [
      'motion outside the reduced-motion gate',
      'html:not([data-save-data]) .a { transition: transform var(--motion-state) ease; }',
      'not gated by reduced motion',
    ],
    [
      'motion inside the wrong media query',
      '@media (min-width: 40rem) { html:not([data-save-data]) .a { transition: transform var(--motion-state) ease; } }',
      'not gated by reduced motion',
    ],
    [
      'a gate with an ungated branch',
      '@media (prefers-reduced-motion: no-preference), print { html:not([data-save-data]) .a { transition: transform var(--motion-state) ease; } }',
      'not gated by reduced motion',
    ],
    [
      'motion without the data saver gate',
      '@media (prefers-reduced-motion: no-preference) { .a { transition: transform var(--motion-state) ease; } }',
      'not gated by data saver',
    ],
    [
      'a selector list with one ungated selector',
      '@media (prefers-reduced-motion: no-preference) { html:not([data-save-data]) .a, .b { transition: transform var(--motion-state) ease; } }',
      'not gated by data saver',
    ],
    [
      'a will-change on layout',
      '@media (prefers-reduced-motion: no-preference) { html:not([data-save-data]) .a { will-change: top; } }',
      'will-change names top',
    ],
    [
      'automatic dark appearance',
      '@media (prefers-color-scheme: dark) { .pic { opacity: 0.9; } }',
      'automatic dark appearance',
    ],
  ])('fails on %s', (_name, css, expected) => {
    const errors = checkPictureSheet(css);
    expect(errors.join('\n')).toContain(expected);
  });
});

describe('at most one moving hero per screen', () => {
  function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full);
      return /\.(?:tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }
  const movingClassUses = (text: string) =>
    (text.match(/(?<![\w-])pic-float(?![\w-])/g) ?? []).length;

  it('no source file names the moving hero class more than once', () => {
    const over = sources(SRC)
      .filter((file) => movingClassUses(readFileSync(file, 'utf8')) > 1)
      .map((file) => file.slice(SRC.length));
    expect(over).toEqual([]);
  });

  it('the count tells one use from two', () => {
    expect(movingClassUses('<DocumentPicture className="pic-float" />')).toBe(1);
    expect(movingClassUses('className="pic-float" /> <PassportCover className="pic-float"')).toBe(
      2,
    );
    expect(movingClassUses('className="pic-floating pic-float-in"')).toBe(0);
  });
});
