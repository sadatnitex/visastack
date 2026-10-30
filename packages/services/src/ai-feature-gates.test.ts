import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * Guard (S28): every call to an AI model goes through an AI feature's switch. A model is called
 * through one of the five AI ports' own methods (`ai.extract`, `ai.classify`, `ai.explain`,
 * `ai.checkConsistency`, `ai.performOcr`). For each such call, every exported function that can
 * reach it inside the same file must ask `openAiFeatureGate` or `getAiFeatureState` itself, so a
 * new model call cannot ship without the platform owner's switch, the plan and the daily limit.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL_METHODS = new Set(['extract', 'classify', 'explain', 'checkConsistency', 'performOcr']);
const GATES = new Set(['openAiFeatureGate', 'getAiFeatureState']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

/** `ai.extract(...)` or `input.fallback.ai.extract(...)`: a model port, by the codebase's naming. */
function isModelCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  if (!MODEL_METHODS.has(method)) return false;
  const receiver = node.expression.expression;
  const name = ts.isIdentifier(receiver)
    ? receiver.text
    : ts.isPropertyAccessExpression(receiver)
      ? receiver.name.text
      : '';
  return name === 'ai';
}

interface FunctionFacts {
  readonly exported: boolean;
  readonly callsModel: boolean;
  readonly gated: boolean;
  readonly calls: ReadonlySet<string>;
}

/** Every top-level function in a file, with what it calls by name. */
function functionsOf(file: string, text: string): Map<string, FunctionFacts> {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const facts = new Map<string, FunctionFacts>();
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    let callsModel = false;
    let gated = false;
    const calls = new Set<string>();
    const visit = (node: ts.Node) => {
      if (isModelCall(node)) callsModel = true;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        calls.add(node.expression.text);
        if (GATES.has(node.expression.text)) gated = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(statement.body);
    const exported =
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
    facts.set(statement.name.text, { exported, callsModel, gated, calls });
  }
  return facts;
}

/** The exported functions that reach a model call without asking for the feature's state. */
function ungatedModelCalls(file: string, text: string): string[] {
  const facts = functionsOf(file, text);
  const reachesModel = new Map<string, boolean>();
  const reaches = (name: string, seen: Set<string>): boolean => {
    const known = reachesModel.get(name);
    if (known !== undefined) return known;
    const fn = facts.get(name);
    if (!fn || seen.has(name)) return false;
    seen.add(name);
    const result = fn.callsModel || [...fn.calls].some((callee) => reaches(callee, seen));
    reachesModel.set(name, result);
    return result;
  };
  const problems: string[] = [];
  for (const [name, fn] of facts) {
    if (fn.exported && reaches(name, new Set()) && !fn.gated) problems.push(name);
  }
  // A model call outside any top-level function (a class method, a callback at module level)
  // cannot be checked this way: it is a problem by itself.
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)) continue;
    let found = false;
    const visit = (node: ts.Node) => {
      if (isModelCall(node)) found = true;
      ts.forEachChild(node, visit);
    };
    visit(statement);
    if (found) problems.push('(a model call outside a top-level function)');
  }
  return problems;
}

describe('every AI model call is behind an AI feature switch (S28)', () => {
  const files = sourceFiles(here).map((file) => ({
    name: path.relative(here, file).split(path.sep).join('/'),
    text: readFileSync(file, 'utf8'),
  }));

  it('finds the model calls it guards, so the scan is not looking at nothing', () => {
    const calling = files
      .filter((f) => functionsOfModelCalls(f.name, f.text) > 0)
      .map((f) => f.name);
    expect(calling).toEqual(['ai.ts']);
    expect(functionsOfModelCalls('ai.ts', files.find((f) => f.name === 'ai.ts')?.text ?? '')).toBe(
      5,
    );
  });

  it('every exported service that can reach a model asks for the feature state first', () => {
    const problems = files.flatMap((f) =>
      ungatedModelCalls(f.name, f.text).map((name) => `${f.name}: ${name}`),
    );
    expect(problems).toEqual([]);
  });

  it('the rule itself sees an exported function that reaches a model without a gate', () => {
    const probe = `
      async function dispatch(ai: Port) { return ai.extract({}); }
      export async function runIt(ai: Port) { return dispatch(ai); }
      export async function gated(ai: Port) { await openAiFeatureGate(db, 'x', c); return dispatch(ai); }
      export async function unrelated() { return 1; }
    `;
    expect(ungatedModelCalls('probe.ts', probe)).toEqual(['runIt']);
  });
});

function functionsOfModelCalls(file: string, text: string): number {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (isModelCall(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}
