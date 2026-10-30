import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guard (S14, ADR 0021 section 3): no AI tool reads data outside `withAiConnection`.
 *
 * A tool module (every non-test file in ai-tools/) may bring in a value only from:
 * - its sibling tool modules;
 * - `../access/with-ai-connection` (the gate, and the pure renderers it re-exports);
 * - `zod` and `@visastack/core` (pure: schemas, catalogue keys, reference codes).
 * Type-only imports are allowed from anywhere, because a type cannot read a row. Anything else,
 * the database package, drizzle, the schema, another service module, a dynamic `import()` or a
 * `require`, fails this test. So the only data a tool can reach is what the gateway composes for
 * the connection's own Selection.
 *
 * The standing identity check behind "Full Document Numbers" (`stepUpFromAiConnection`) may be
 * used by the gate alone.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..');

const PACKAGE_SOURCES = new Set(['zod', '@visastack/core', '@visastack/core/catalogue']);
const GATE = path.join(srcDir, 'access', 'with-ai-connection');

function isTest(file: string): boolean {
  return /\.test\.ts$/.test(file) || /\.test-support\.ts$/.test(file);
}

/** Every non-test file under ai-tools/, in subfolders too. */
function toolModules(): string[] {
  return walk(here);
}

/** The value-carrying imports and re-exports of one file, and any dynamic loading. */
function boundaryViolations(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  // Relative specifiers are resolved from the file itself, so a helper in a subfolder is judged
  // by where its import really lands: inside ai-tools/, or the gate.
  const allowed = (specifier: string) => {
    if (PACKAGE_SOURCES.has(specifier)) return true;
    if (!specifier.startsWith('.')) return false;
    const target = path.resolve(path.dirname(fileName), specifier).replace(/\.ts$/, '');
    return target === GATE || target.startsWith(`${here}${path.sep}`);
  };

  const check = (specifier: string, typeOnly: boolean, what: string) => {
    if (typeOnly || allowed(specifier)) return;
    problems.push(`${path.relative(here, fileName)}: ${what} from '${specifier}'`);
  };

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const specifier = statement.moduleSpecifier.text;
      if (!clause) {
        check(specifier, false, 'side-effect import');
        continue;
      }
      const bindings = clause.namedBindings;
      const everyNamedIsType =
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.every((element) => element.isTypeOnly);
      const typeOnly = clause.isTypeOnly || (clause.name === undefined && everyNamedIsType);
      check(specifier, typeOnly, 'value import');
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.exportClause;
      const everyNamedIsType =
        clause !== undefined &&
        ts.isNamedExports(clause) &&
        clause.elements.every((element) => element.isTypeOnly);
      check(statement.moduleSpecifier.text, statement.isTypeOnly || everyNamedIsType, 're-export');
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        problems.push(`${path.basename(fileName)}: dynamic import()`);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        problems.push(`${path.basename(fileName)}: require()`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !isTest(entry.name)) out.push(full);
  }
  return out;
}

describe('AI tools reach data only through withAiConnection', () => {
  it('finds the five tools and the runner', () => {
    const names = toolModules().map((f) => path.relative(here, f));
    for (const expected of [
      'prepare-context.ts',
      'list-cases.ts',
      'get-profile-section.ts',
      'list-documents.ts',
      'get-document-text.ts',
      'get-document-file.ts',
      'index.ts',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('no tool module imports data access, a database or another service', () => {
    const problems = toolModules().flatMap((file) =>
      boundaryViolations(file, readFileSync(file, 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('the rule itself catches each way around it', () => {
    const cases = [
      "import { schema } from '@visastack/db';",
      "import { eq } from 'drizzle-orm';",
      "import { schema } from '../db';",
      "import { buildSelectedOutput } from '../selected-output';",
      "import { requireAccess } from '../access';",
      "import { resolveAiAccessToken } from '../access/ai-connection';",
      "import * as everything from '..';",
      "import '../db';",
      "export { schema } from '../db';",
      "import { x } from './../db';",
      "import { renderAiContext } from '../access/with-ai-connection-copy';",
      "const m = await import('../db');",
      "const m = require('../db');",
    ];
    for (const source of cases) {
      expect(boundaryViolations(path.join(here, 'probe.ts'), source), source).not.toEqual([]);
    }
    for (const source of [
      "import type { Db } from '../db';",
      "import { type SelectedOutput } from '../selected-output';",
      "import { renderAiContext } from '../access/with-ai-connection';",
      "import { z } from 'zod';",
      "import { refusal } from './result';",
    ]) {
      expect(boundaryViolations(path.join(here, 'probe.ts'), source), source).toEqual([]);
    }
  });

  it('only the gate makes the standing identity check for full numbers', () => {
    const users = walk(srcDir)
      .filter((file) => readFileSync(file, 'utf8').includes('stepUpFromAiConnection'))
      .map((file) => path.relative(srcDir, file).replace(/\\/g, '/'))
      .sort();
    expect(users).toEqual(['access/step-up-proof.ts', 'access/with-ai-connection.ts']);
    // Never part of the access package's public face, nor of the services package.
    for (const index of ['access/index.ts', 'index.ts']) {
      expect(readFileSync(path.join(srcDir, index), 'utf8')).not.toContain(
        'stepUpFromAiConnection',
      );
    }
  });

  it('only the gate makes the standing identity check for an Original file (S20)', () => {
    const users = walk(srcDir)
      .filter((file) => readFileSync(file, 'utf8').includes('stepUpForAiOriginalFile'))
      .map((file) => path.relative(srcDir, file).replace(/\\/g, '/'))
      .sort();
    expect(users).toEqual(['access/step-up-proof.ts', 'access/with-ai-connection.ts']);
    for (const index of ['access/index.ts', 'index.ts']) {
      expect(readFileSync(path.join(srcDir, index), 'utf8')).not.toContain(
        'stepUpForAiOriginalFile',
      );
    }
    // Only the gate gives files: no tool module reads storage or makes a copy itself.
    for (const file of toolModules()) {
      const text = readFileSync(file, 'utf8');
      for (const name of ['produceSafeCopy', 'readOriginalDocumentFile', 'getObject']) {
        expect(text, `${path.basename(file)} ${name}`).not.toContain(name);
      }
    }
  });
});
