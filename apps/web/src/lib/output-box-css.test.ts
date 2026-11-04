import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * An <output> is an inline element. Given padding, a border or a background and no display, a note
 * that wraps draws its box over the lines above and below it (the Field Insights note did). Every
 * class an <output> carries in the app that has a box must also make the element a block, or a
 * flex, grid or inline-block item.
 */
const root = resolve(__dirname, '..');
const css = readFileSync(resolve(root, 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** The class list of every <output> in the app that names its classes in plain words. */
function outputElements(): string[][] {
  const found: string[][] = [];
  for (const file of sourceFiles(root)) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /<output\b[^>]*?className="([^"]*)"/g,
    )) {
      found.push((match[1] ?? '').split(/\s+/).filter((token) => /^[a-z][\w-]*$/.test(token)));
    }
  }
  return found;
}

/** The declaration blocks of rules whose selector is this class alone, or output.class. */
function bodies(className: string): string[] {
  const out: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] ?? '').split(',').map((part) => part.trim());
    if (selectors.some((part) => part === `.${className}` || part === `output.${className}`)) {
      out.push(rule[2] ?? '');
    }
  }
  return out;
}

describe('a boxed note on an output is not left inline', () => {
  const elements = outputElements();

  it('finds the notices the app draws', () => {
    expect(elements.some((classes) => classes.includes('notice'))).toBe(true);
  });

  it('gives every boxed output a block, flex, grid or positioned layout', () => {
    const inline: string[] = [];
    for (const classes of elements) {
      const rules = classes.flatMap(bodies);
      const boxed = rules.some((body) =>
        /(^|[;\s])(padding|border|background)[\w-]*\s*:/.test(body),
      );
      const laidOut = rules.some(
        (body) =>
          /display\s*:\s*(block|flex|grid|inline-block|inline-flex|inline-grid|contents|none)/.test(
            body,
          ) || /position\s*:\s*(absolute|fixed)/.test(body),
      );
      if (boxed && !laidOut) inline.push(classes.join(' '));
    }
    expect([...new Set(inline)]).toEqual([]);
  });

  it('makes the plain notice a block, so a wrapped note stays one box', () => {
    expect(css).toMatch(/output\.notice\s*\{[^}]*display:\s*block/);
  });
});
