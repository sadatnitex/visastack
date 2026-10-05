import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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

/** Attributes whose value is code or markup plumbing, not text a person reads. */
const NON_VISIBLE_ATTRIBUTES = new Set([
  'accept',
  'action',
  'autoComplete',
  'className',
  'defaultValue',
  'href',
  'htmlFor',
  'id',
  'inputMode',
  'key',
  'method',
  'name',
  'rel',
  'role',
  'src',
  'style',
  'target',
  'type',
  'value',
]);

const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bmissions?\b/i, why: 'say "case"' },
  { pattern: /\bprovider schema\b/i, why: 'internal implementation vocabulary' },
  { pattern: /\bjob lease\b/i, why: 'internal implementation vocabulary' },
];

interface Visible {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const COMPARISON = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

function isCodeValue(text: string): boolean {
  if (!/[A-Za-z]/.test(text)) return true;
  if (text.startsWith('/') || /^https?:/.test(text)) return true;
  // One lowercase word ('mission', 'applicant') or a dotted translation key
  // ('mission.readiness.ready') is an identifier-like value, not prose.
  return /^[a-z][a-z0-9_-]*$/.test(text) || /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(text);
}

function visibleText(file: string, source: string): Visible[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found: Visible[] = [];
  const add = (text: string, node: ts.Node) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length === 0 || isCodeValue(clean)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    found.push({ file, line, text: clean });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isLiteralTypeNode(node)) return;
    if (ts.isJsxText(node)) {
      add(node.text, node);
      return;
    }
    if (ts.isJsxAttribute(node) && NON_VISIBLE_ATTRIBUTES.has(node.name.getText(sf))) return;
    if (ts.isCaseClause(node)) {
      for (const statement of node.statements) visit(statement);
      return;
    }
    if (ts.isBinaryExpression(node) && COMPARISON.has(node.operatorToken.kind)) {
      if (!ts.isStringLiteralLike(node.left)) visit(node.left);
      if (!ts.isStringLiteralLike(node.right)) visit(node.right);
      return;
    }
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name)) {
      visit(node.initializer);
      return;
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      visit(node.expression);
      return;
    }
    if (ts.isStringLiteralLike(node)) {
      add(node.text, node);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      add(node.head.text + node.templateSpans.map((s) => `{}${s.literal.text}`).join(''), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

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
