import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * VS-006: `attachPackVersion` checks only that a version is published, so a caller that skips the
 * selection rule (`selectionRefusal`) could put an unreviewed or another agency's checklist on a
 * case. Outside tests, exactly two places may call it, and each applies the rule first: the
 * checked attach (`attachSelectedPackVersion`) and Prepare Again. A new caller fails this test.
 */

const SRC = __dirname;
const CALL = /(?<!function )\battachPackVersion\s*\(/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|test-support)\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

const callsByFile = (): Record<string, number> => {
  const found: Record<string, number> = {};
  for (const file of sourceFiles(SRC)) {
    const count = (readFileSync(file, 'utf8').match(CALL) ?? []).length;
    if (count > 0) found[relative(SRC, file).replaceAll('\\', '/')] = count;
  }
  return found;
};

describe('who may call the bare attachPackVersion (VS-006)', () => {
  it('only the checked attach and Prepare Again, once each', () => {
    expect(callsByFile()).toEqual({
      'missions.ts': 1,
      'umpe-pack-selection.ts': 1,
    });
  });

  it('applies the selection rule right before each of those calls', () => {
    const missions = readFileSync(join(SRC, 'missions.ts'), 'utf8');
    const prepare = missions.slice(missions.indexOf('if (plan.packVersion) {'));
    const callAt = prepare.search(/\battachPackVersion\s*\(/);
    expect(callAt).toBeGreaterThan(0);
    expect(prepare.slice(0, callAt)).toContain('selectionRefusal(');
    const selection = readFileSync(join(SRC, 'umpe-pack-selection.ts'), 'utf8');
    const checkedAt = selection.search(/\battachPackVersion\s*\(/);
    expect(selection.slice(0, checkedAt)).toContain('selectionRefusal(');
  });

  it('the pattern notices a call and skips a definition and a plain mention', () => {
    expect('await attachPackVersion(db, x)'.match(CALL)).toHaveLength(1);
    expect('export async function attachPackVersion('.match(CALL)).toBeNull();
    expect('// see attachPackVersion for details'.match(CALL)).toBeNull();
  });
});
