import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Reads source files with the TypeScript parser and returns the text a person can see or
 * hear: JSX text, labels, titles, messages. It ignores identifiers, import paths, URLs,
 * CSS classes, `case` labels and comparisons, and one-word lowercase literals that are code
 * values. Shared by the vocabulary check (no internal product names reach a reader) and
 * the translated-surface check (no hard-coded English is left on a translated screen).
 */

export const WEB_SRC = fileURLToPath(new URL('..', import.meta.url));

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

export interface Visible {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export function sourceFiles(dir: string): string[] {
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

export function visibleText(file: string, source: string): Visible[] {
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
