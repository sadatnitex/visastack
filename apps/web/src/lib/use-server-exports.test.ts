import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Next.js lets a file that starts with "use server" export only async functions. Any other value
 * (an object, a number, a plain function) loads fine in tests, where the file is imported as an
 * ordinary module, but the first time a person presses a button on the live site the page fails
 * with "A use server file can only export async functions". So every exported value of such a file
 * must be an async function. Types and interfaces are erased and are fine. A shared constant goes
 * in a file that is not a server action file.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$|\.test-support\./.test(entry.name)
      ? [full]
      : [];
  });
}

function isUseServer(sf: ts.SourceFile): boolean {
  const first = sf.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  );
}

function isAsyncFunctionValue(node: ts.Expression | undefined): boolean {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node)) return isAsyncFunctionValue(node.expression);
  return (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    (ts.getCombinedModifierFlags(node as unknown as ts.Declaration) & ts.ModifierFlags.Async) !== 0
  );
}

/** What a "use server" file exports that is not an async function, as "file: name". */
export function badServerExports(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (!isUseServer(sf)) return [];
  const rel = path.relative(appRoot, file).replace(/\\/g, '/');
  const bad: string[] = [];
  for (const statement of sf.statements) {
    const exported =
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isExportDeclaration(statement)) {
      // `export { a, b }` or `export * from`: only type-only forms are erased.
      if (!statement.isTypeOnly) {
        const names =
          statement.exportClause && ts.isNamedExports(statement.exportClause)
            ? statement.exportClause.elements.filter((e) => !e.isTypeOnly).map((e) => e.name.text)
            : ['*'];
        for (const name of names) bad.push(`${rel}: ${name}`);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (!isAsyncFunctionValue(statement.expression)) bad.push(`${rel}: default`);
      continue;
    }
    if (!exported) continue;
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    if (ts.isFunctionDeclaration(statement)) {
      const isAsync = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (!isAsync) bad.push(`${rel}: ${statement.name?.text ?? 'default'}`);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!isAsyncFunctionValue(declaration.initializer)) {
          bad.push(`${rel}: ${declaration.name.getText(sf)}`);
        }
      }
      continue;
    }
    // A class, enum or anything else is a value too.
    bad.push(
      `${rel}: ${ts.isClassDeclaration(statement) ? (statement.name?.text ?? 'class') : 'value'}`,
    );
  }
  return bad;
}

describe('"use server" files export only async functions', () => {
  it('every server action file in the app', () => {
    const problems = sourceFiles(appRoot).flatMap((file) =>
      badServerExports(file, readFileSync(file, 'utf8')),
    );
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('catches an object, a number and a plain function (the guard itself can fail)', () => {
    const file = path.join(appRoot, 'app', 'synthetic-actions.ts');
    const source = `'use server';
export const NO_PREVIEW = { ok: false };
export const LIMIT = 5;
export function plain() { return 1; }
export const okArrow = async () => 1;
export async function okFunction() { return 1; }
export interface Fine { a: string }
export type AlsoFine = string;
`;
    expect(badServerExports(file, source)).toEqual([
      'app/synthetic-actions.ts: NO_PREVIEW',
      'app/synthetic-actions.ts: LIMIT',
      'app/synthetic-actions.ts: plain',
    ]);
    expect(badServerExports(file, 'export const NOT_A_SERVER_FILE = { ok: true };\n')).toEqual([]);
  });
});
