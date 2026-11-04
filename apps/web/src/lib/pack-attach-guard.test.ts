import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * VS-006: the web app attaches a checklist to a case only through `attachSelectedPackVersion`,
 * which refuses an unreviewed pack and another agency's private pack. The bare `attachPackVersion`
 * checks only that the version is published, so a screen or action that called it would let a
 * crafted request attach a checklist nobody reviewed. No code under apps/web may name it.
 */

const SRC = join(__dirname, '..');
const BARE_ATTACH = /\battachPackVersion\b/;
const SELECTED_ATTACH = /\battachSelectedPackVersion\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|test-support)\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe('attaching a checklist from the web app (VS-006)', () => {
  const files = sourceFiles(SRC);

  it('never calls the bare attachPackVersion', () => {
    const offenders = files
      .filter((file) => BARE_ATTACH.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length));
    expect(offenders).toEqual([]);
  });

  it('attaches through the checked function in all four places that attach', () => {
    const users = files
      .filter((file) => SELECTED_ATTACH.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length).replaceAll('\\', '/'))
      .sort();
    expect(users).toEqual([
      '/app/app/applicant/[id]/missions/actions.ts',
      '/app/app/mission/[id]/actions.ts',
      '/app/app/mission/start/actions.ts',
      '/app/app/trips/trip-checklist.ts',
    ]);
  });

  it('the pattern notices a bare call, and does not mistake the checked one for it', () => {
    expect(BARE_ATTACH.test("import { attachPackVersion } from '@visastack/services';")).toBe(true);
    expect(BARE_ATTACH.test('await attachPackVersion(db, input)')).toBe(true);
    expect(BARE_ATTACH.test('await attachSelectedPackVersion(db, input)')).toBe(false);
  });
});
