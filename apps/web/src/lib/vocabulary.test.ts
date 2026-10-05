import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sourceFiles, visibleText } from './visible-text.test-support';

/**
 * Commercial V1 Part 9 UX-01: internal implementation vocabulary must not reach
 * ordinary people. The product's word for what a traveller opens is "case";
 * "mission" is the stored entity's name and stays in code, URLs and the
 * database. This reads every page and component with the TypeScript parser and
 * checks the text a person can actually see or hear: JSX text, labels, titles,
 * messages. It ignores identifiers, import paths, URLs, CSS classes, `case`
 * labels and comparisons, and one-word lowercase literals that are code values
 * (`'mission'` as a union member), so renaming the code is never forced.
 */

const WEB_SRC = fileURLToPath(new URL('..', import.meta.url));

const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bmissions?\b/i, why: 'say "case"' },
  { pattern: /\bprovider schema\b/i, why: 'internal implementation vocabulary' },
  { pattern: /\bjob lease\b/i, why: 'internal implementation vocabulary' },
];

describe('visibleText (the scanner itself)', () => {
  const scan = (code: string) => visibleText('sample.tsx', code).map((v) => v.text);

  it('reads JSX text, attribute labels, messages and template literals', () => {
    expect(scan('const a = <p title="Your missions">Open Missions</p>;')).toEqual([
      'Your missions',
      'Open Missions',
    ]);
    expect(scan('const m = { message: `Mission moved to ${state}.` };')).toEqual([
      'Mission moved to {}.',
    ]);
  });

  it('ignores identifiers, paths, classes, comparisons, case labels and code values', () => {
    expect(
      scan(`
        import { listMissions } from '../missions/missions-page';
        const href = '/app/applicant/1/missions';
        const kind: 'mission' | 'document' = 'mission';
        if (scope === 'mission') run();
        switch (x) { case 'mission': break; }
        const el = <a href="/app/mission/1" className="mission-row" id="mission-1">Open the case</a>;
        const lookup = byKind['mission'];
      `),
    ).toEqual(['Open the case']);
  });
});

describe('visible text uses product words (directive Part 9 UX-01)', () => {
  const files = sourceFiles(join(WEB_SRC, 'app')).concat(sourceFiles(join(WEB_SRC, 'components')));
  const all = files.flatMap((file) => visibleText(file, readFileSync(file, 'utf8')));

  it('actually scans the pages it is meant to check', () => {
    expect(files.length).toBeGreaterThan(80);
    expect(all.length).toBeGreaterThan(500);
    expect(all.some((v) => v.text.includes('Active cases'))).toBe(true);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`has no visible text matching ${pattern} (${why})`, () => {
      const hits = all
        .filter((v) => pattern.test(v.text))
        .map((v) => `${relative(WEB_SRC, v.file)}:${v.line}: ${JSON.stringify(v.text)}`);
      expect(hits, hits.join('\n')).toEqual([]);
    });
  }
});
