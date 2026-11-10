import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The destination label looks a saved country name up in the whole country list, so it belongs on
 * the server: a client file that imported it would carry that list to the browser. (The usual
 * `server-only` marker is not used here because the scroll-budget browser harness bundles some of
 * these pages and cannot resolve it.)
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

describe('the destination label stays on the server', () => {
  it('is imported by no file that starts with "use client"', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return (
        /^\s*['"]use client['"]/.test(text) &&
        /from\s+['"][^'"]*(destination-label|case-list-model)['"]/.test(text)
      );
    });
    expect(offenders).toEqual([]);
  });
});
