import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Layouts and pages render in parallel, so a sync server component that calls `getServerT` can
 * run before the locale is known. Any page whose module tree reaches `getServerT` must therefore
 * `await primeLocale()` in its default export (docs/localization/I18N_RUNTIME.md).
 */
const SRC = resolve(__dirname, '..');
const EXTENSIONS = ['.tsx', '.ts', '/index.tsx', '/index.ts'];

function pagesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pagesUnder(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  return null;
}

function reachesServerT(entry: string): boolean {
  const seen = new Set<string>();
  const visit = (file: string): boolean => {
    if (seen.has(file) || file.endsWith('i18n-server.ts') || file.includes('.test.')) return false;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    if (/\bgetServerT\b/.test(text)) return true;
    if (/^\s*['"]use client['"]/.test(text)) return false;
    const specifiers = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
    return specifiers.some((specifier) => {
      const target = resolveImport(file, specifier);
      return target !== null && visit(target);
    });
  };
  return visit(entry);
}

describe('pages that use getServerT prime the locale', () => {
  const pages = pagesUnder(join(SRC, 'app'));

  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it('every such page awaits primeLocale() in its default export', () => {
    const missing = pages
      .filter((page) => reachesServerT(page))
      .filter((page) => !/await\s+primeLocale\(\)/.test(readFileSync(page, 'utf8')))
      .map((page) => page.slice(SRC.length + 1));
    expect(missing).toEqual([]);
  });
});
