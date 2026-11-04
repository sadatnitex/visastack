import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASE_ANCHOR, agencyCaseHref, caseAnchorId } from './case-anchor';

const SRC = resolve(__dirname, '../../../..');

/** True when the file's first statement is the client marker (comments may come first). */
const isClientModule = (source: string) => {
  let rest = source.trimStart();
  for (;;) {
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/');
      if (end < 0) return false;
      rest = rest.slice(end + 2).trimStart();
    } else if (rest.startsWith('//')) {
      const end = rest.indexOf('\n');
      if (end < 0) return false;
      rest = rest.slice(end + 1).trimStart();
    } else {
      break;
    }
  }
  return rest.startsWith("'use client'") || rest.startsWith('"use client"');
};

describe('case anchor (VS-023)', () => {
  it('builds the in-page address of a case from real text', () => {
    expect(CASE_ANCHOR).toBe('mission-');
    expect(caseAnchorId('m1')).toBe('mission-m1');
    expect(agencyCaseHref('o1', 'm1')).toBe('/app/agency/o1/cases#mission-m1');
    for (const value of [CASE_ANCHOR, caseAnchorId('m1'), agencyCaseHref('o1', 'm1')]) {
      expect(value).not.toContain('[object');
      expect(value).not.toContain('undefined');
    }
  });

  it('stays a pure module: no client marker and no imports', () => {
    const source = readFileSync(join(__dirname, 'case-anchor.ts'), 'utf8');
    expect(isClientModule(source)).toBe(false);
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.test-support\.tsx?$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

/**
 * Known offences still waiting for their owner's fix: the page cannot read the real labels. Each
 * entry must still be an offence, so the fix removes its entry here.
 */
const PENDING = [
  "/app/app/admin/packs/sources/page.tsx imports AUTHORITY_TIER_LABELS from a 'use client' module",
];

describe('server pages and client modules (VS-023)', () => {
  it('a server file imports only components, never plain values, from a client module', () => {
    const files = sourceFiles(SRC);
    const clientFiles = new Set(files.filter((file) => isClientModule(readFileSync(file, 'utf8'))));
    const offences: string[] = [];
    for (const file of files) {
      if (clientFiles.has(file)) continue;
      const source = readFileSync(file, 'utf8');
      const importPattern =
        /(?:import|export)\s+(type\s+)?(?:\w+\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+(\w+))\s+from\s+['"](\.[^'"]*)['"]/g;
      for (const match of source.matchAll(importPattern)) {
        if (match[1]) continue;
        const target = resolveRelative(file, match[4] ?? '');
        if (!target || !clientFiles.has(target)) continue;
        if (match[3]) {
          offences.push(`${file.slice(SRC.length)} imports * from a 'use client' module`);
          continue;
        }
        for (const part of (match[2] ?? '').split(',')) {
          const name =
            part
              .trim()
              .replace(/^type\s+.*/, '')
              .split(/\s+as\s+/)[0]
              ?.trim() ?? '';
          if (name && !/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(name)) {
            offences.push(`${file.slice(SRC.length)} imports ${name} from a 'use client' module`);
          }
        }
      }
    }
    expect(offences.filter((line) => !PENDING.includes(line))).toEqual([]);
    expect(PENDING.filter((line) => !offences.includes(line))).toEqual([]);
  });
});
