import { existsSync, readFileSync } from 'node:fs';
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

describe('lifecycle screens use the lifecycle words (docs/uiux/ccd/VOCABULARY.md, Resource lifecycle)', () => {
  const RETIRED =
    /\b(eras(e|ed|ing|ure)|purg(e|ed|es|ing)|tombstones?|supersed(e|ed|es|ing)|soft delet\w*|cascad\w*|fact versions?)\b/i;
  const files = [
    ...sourceFiles(join(WEB_SRC, 'components', 'lifecycle')),
    ...sourceFiles(join(WEB_SRC, 'app', 'app', 'applicant', '[id]', 'documents', 'manage')),
    // Lane C's page, once it exists.
    ...(existsSync(join(WEB_SRC, 'app', 'app', 'applicant', '[id]', 'removal-records'))
      ? sourceFiles(join(WEB_SRC, 'app', 'app', 'applicant', '[id]', 'removal-records'))
      : []),
  ];
  const all = files.flatMap((file) => visibleText(file, readFileSync(file, 'utf8')));

  it('scans the lifecycle screens', () => {
    expect(files.length).toBeGreaterThan(4);
    expect(all.some((v) => v.text.includes('Removing Securely'))).toBe(true);
  });

  it('never shows a retired word there', () => {
    const hits = all
      .filter((v) => RETIRED.test(v.text))
      .map((v) => `${relative(WEB_SRC, v.file)}:${v.line}: ${JSON.stringify(v.text)}`);
    expect(hits, hits.join('\n')).toEqual([]);
  });
});

describe('traveller screens keep engineering words out (first journey, lane 1)', () => {
  /**
   * Words a Bangladesh traveller reading English as a second language should not meet. A stored
   * code such as STALE is not visible text, so it is untouched; only what a person sees is checked.
   * Sharing, evidence, agency, admin and the case page belong to other packages and are scanned
   * once those packages rewrite their wording.
   */
  const BANNED: readonly { readonly pattern: RegExp; readonly say: string }[] = [
    { pattern: /\bintrinsic\b/i, say: 'say "the document\'s own date"' },
    { pattern: /\bmachine-readable\b/i, say: 'say "code lines"' },
    { pattern: /\bimmutable\b/i, say: 'say what is kept, in plain words' },
    { pattern: /\bsuperseded\b/i, say: 'say "replaced"' },
    { pattern: /\bstale\b/i, say: 'say "no longer current"' },
    { pattern: /\bconflicted\b/i, say: 'say "does not match"' },
    { pattern: /\bpurpose-bound\b/i, say: 'say what it is used for' },
    { pattern: /\bprovenance\b/i, say: 'say where it came from' },
    { pattern: /\bevidence wallet\b/i, say: 'say "documents"' },
    { pattern: /\bdocument-supported\b/i, say: 'say "backed by a document"' },
    { pattern: /\bassurance\b/i, say: 'say what is confirmed and by whom' },
    {
      pattern: /\b(allow|turn on) core processing\b/i,
      say: 'say "Let VisaStack Process My Details"',
    },
    { pattern: /\b(briefs? and summaries|prepare a brief)\b/i, say: 'say "Summaries"' },
  ];
  const OTHER_PACKAGES = [
    join('app', 'app', 'agency'),
    join('app', 'app', 'admin'),
    join('app', 'app', 'shared'),
    join('app', 'app', 'mission', '[id]'),
    join('app', 'app', 'applicant', '[id]', 'sharing'),
    join('app', 'app', 'applicant', '[id]', 'evidence'),
  ];
  const files = sourceFiles(join(WEB_SRC, 'app', 'app')).filter(
    (file) => !OTHER_PACKAGES.some((part) => relative(WEB_SRC, file).startsWith(part)),
  );
  const all = files.flatMap((file) => visibleText(file, readFileSync(file, 'utf8')));

  it('scans the traveller screens', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(all.some((v) => v.text.includes('Fields Backed by a Document'))).toBe(true);
  });

  for (const { pattern, say } of BANNED) {
    it(`shows no ${pattern} (${say})`, () => {
      const hits = all
        .filter((v) => pattern.test(v.text))
        .map((v) => `${relative(WEB_SRC, v.file)}:${v.line}: ${JSON.stringify(v.text)}`);
      expect(hits, hits.join('\n')).toEqual([]);
    });
  }
});
