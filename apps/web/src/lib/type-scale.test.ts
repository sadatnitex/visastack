import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Small text uses one of three sizes (caption, small, body). Anything between 8px and 16.5px
 * that is not one of those is a new in-between size and fails here. Larger display sizes are
 * outside this guard.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ON_SCALE_PX = new Set([12, 13.6, 16]);

function offScale(value: string): boolean {
  const m = /^([0-9.]+)(rem|px)$/.exec(value.trim());
  if (!m) return false;
  const px = m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16;
  if (px < 8 || px > 16.5) return false;
  return !ON_SCALE_PX.has(Math.round(px * 100) / 100);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

describe('small text sizes stay on the scale', () => {
  it('the style sheet has no in-between font sizes', () => {
    const css = readFileSync(join(SRC, 'app/globals.css'), 'utf8');
    // Selectors whose size is pinned to the design reference by an end-to-end test.
    const pinned = ['.trust-hero .eyebrow'];
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      (rule) => !pinned.some((selector) => (rule[1] as string).trim().endsWith(selector)),
    );
    const bad = rules
      .flatMap((rule) => [
        ...(rule[2] as string).matchAll(/font-size:\s*([0-9.]+(?:rem|px))\s*;?/g),
      ])
      .map((m) => m[1] as string)
      .filter(offScale);
    expect(bad).toEqual([]);
  });

  it('pages carry no in-between inline font sizes', () => {
    const bad: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/fontSize:\s*'([0-9.]+(?:rem|px))'/g)) {
        if (offScale(m[1] as string)) bad.push(`${file}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
