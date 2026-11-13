import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Ratchet: every exported service function that is told which organization to act for must also
 * be told who is acting, and must check that person against that organization itself. Modelled on
 * the access enforcement ratchet (enforcement.test.ts) and resolved through the TypeScript type
 * checker, never text.
 *
 * - "Told which organization": a parameter named like an organization id (`organizationId`,
 *   `orgId`, `organizationIds`), or an object parameter whose type has an `organizationId`
 *   property. The name of the function does not matter (`*ForOrg` or not).
 * - "Who is acting": a parameter named `actor`, `actorAccountId`, `accountId` or `principal`, or an object
 *   parameter whose type has an `actorAccountId`, `actor` or `accountId` property, or a gate type minted in
 *   access/ (`AuthorizedApplicant`, `StaffScope`, `SystemScope`, ...), which already proves who it
 *   is for.
 * - "Checks that person": unless a gate type is taken, the function reaches, through any functions
 *   of this package it calls (exported or not), one of the existing membership checks:
 *   `isActiveMember`, `isOrgAdmin`, `isMember`, or `mayReadOrgCase`, the agency read rule built
 *   from them, or reads the memberships table itself (the same check written in place); for a
 *   platform staff action, the platform role checks (`isPlatformOwner`, `hasAnyPlatformRole`,
 *   `canPerformPlatformAction`). There is no second permission model.
 *
 * Anything else must be listed in org-actor-exceptions.json with its kind and a reason a reviewer
 * reads (a data file, so the list is not source that other source guards scan).
 *
 * Kinds: `internal` (never exported from the package entry, held below, so only this package can
 * call it, after its own check of the person), `pure` (reads nothing), `staff` (a platform staff
 * action whose web route checks the staff permission first), `display` (the agency's public name
 * and logo), `caller-checked` (called only after the caller's own membership or staff check; named
 * so the next change to it moves the check into the service). The list is fixed, not a baseline. An `internal` exception must not be exported from the package entry (src/index.ts), so
 * the web app and the other packages cannot call it. An exception that is no longer needed, or
 * names a function that no longer exists, fails.
 */

interface OrgActorException {
  readonly kind: 'internal' | 'pure' | 'staff' | 'display' | 'caller-checked';
  readonly reason: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const servicesDir = realpathSync(path.resolve(here, '../..'));
const srcDir = path.join(servicesDir, 'src');
const accessDir = path.join(srcDir, 'access');
const indexFile = path.join(srcDir, 'index.ts');
const ORG_ACTOR_EXCEPTIONS = JSON.parse(
  readFileSync(path.join(accessDir, 'org-actor-exceptions.json'), 'utf8'),
) as Readonly<Record<string, OrgActorException>>;
const schemaFile = realpathSync(path.resolve(servicesDir, '../db/src/schema.ts'));

const ORG_PARAM_NAMES = new Set(['organizationId', 'orgId', 'organizationIds']);
const ORG_PROPERTY_NAMES = ['organizationId', 'organizationIds'];
const ACTOR_PARAM_NAMES = new Set(['actor', 'actorAccountId', 'accountId', 'principal']);
const ACTOR_PROPERTY_NAMES = ['actorAccountId', 'actor', 'accountId'];
/** The existing membership checks, as `module#name`. */
const CHECKS = new Set([
  'agency#isActiveMember',
  'organizations#isOrgAdmin',
  'organizations#isMember',
  'agency#mayReadOrgCase',
  // Platform staff (never an agency member): the action is staff-only, checked by role.
  'platform-roles#isPlatformOwner',
  'platform-roles#hasAnyPlatformRole',
  'platform-roles#canPerformPlatformAction',
]);
const GATE_TYPES = new Set([
  'AuthorizedApplicant',
  'SystemScope',
  'StaffScope',
  'SelfScope',
  'AgencyCollectionScope',
  'CollectionResponseAccess',
  'AgencyChecklistScope',
  'TripCompanionAccess',
]);

function isTestFile(fileName: string): boolean {
  return /\.test\.ts$/.test(fileName) || /\.test-support\.ts$/.test(fileName);
}

function real(fileName: string): string {
  try {
    return realpathSync(fileName);
  } catch {
    return path.resolve(fileName);
  }
}

function moduleId(fileName: string): string {
  return path.relative(srcDir, real(fileName)).replace(/\\/g, '/').replace(/\.ts$/, '');
}

function inServices(node: ts.Node): boolean {
  const file = real(node.getSourceFile().fileName);
  return file.startsWith(srcDir + path.sep) && !isTestFile(file);
}

function loadProgram(): ts.Program {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(servicesDir, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!parsed) throw new Error('could not read packages/services/tsconfig.json');
  const rootNames = parsed.fileNames.filter((f) => !isTestFile(f));
  return ts.createProgram({ rootNames, options: { ...parsed.options, noEmit: true } });
}

function resolve(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) return checker.getAliasedSymbol(symbol);
  return symbol;
}

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function unwrap(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The function bodies a declaration stands for (the implementation of an overload set). */
function functionsOf(decl: ts.Declaration): FunctionLike[] {
  if (ts.isFunctionDeclaration(decl)) return decl.body ? [decl] : [];
  if (ts.isVariableDeclaration(decl) && decl.initializer) {
    const init = unwrap(decl.initializer);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return [init];
    // `export const f = wrap(async (...) => ...)`: judged by the functions it wraps.
    if (ts.isCallExpression(init)) return wrappedFunctions(init);
  }
  return [];
}

/** The functions passed, at any depth, into a wrapping call such as `wrap(async () => ...)`. */
function wrappedFunctions(call: ts.CallExpression): FunctionLike[] {
  const found: FunctionLike[] = [];
  for (const arg of call.arguments) {
    const unwrapped = unwrap(arg);
    if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) found.push(unwrapped);
    else if (ts.isCallExpression(unwrapped)) found.push(...wrappedFunctions(unwrapped));
  }
  return found;
}

/** True if an argument names the acting person (`actorAccountId`, `input.actor`, `accountId`, ...). */
function mentionsActor(node: ts.Node): boolean {
  if (ts.isIdentifier(node) && ACTOR_PARAM_NAMES.has(node.text)) return true;
  return ts.forEachChild(node, (child) => (mentionsActor(child) ? true : undefined)) === true;
}

function declarationName(decl: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(decl)) return decl.name?.text;
  if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) return decl.name.text;
  return undefined;
}

function typeHasProperty(checker: ts.TypeChecker, type: ts.Type, names: readonly string[]) {
  const parts = type.isUnion() ? type.types : [type];
  return parts.some((part) => {
    if (part.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike)) return false;
    return names.some((name) => checker.getPropertyOfType(part, name) !== undefined);
  });
}

function isGateType(type: ts.Type): boolean {
  if (type.getConstructSignatures().length > 0) return false;
  const symbols = [type.aliasSymbol, type.getSymbol()];
  const gate = symbols.some(
    (s) =>
      s !== undefined &&
      GATE_TYPES.has(s.name) &&
      (s.declarations ?? []).some((d) =>
        real(d.getSourceFile().fileName).startsWith(accessDir + path.sep),
      ),
  );
  if (gate) return true;
  if (type.isUnion()) return type.types.every((t) => isGateType(t));
  return false;
}

interface Shape {
  readonly takesOrg: boolean;
  readonly takesActor: boolean;
  readonly takesGate: boolean;
}

function shapeOf(checker: ts.TypeChecker, fn: FunctionLike): Shape {
  let takesOrg = false;
  let takesActor = false;
  let takesGate = false;
  for (const param of fn.parameters) {
    const name = ts.isIdentifier(param.name) ? param.name.text : undefined;
    const type = checker.getTypeAtLocation(param);
    if (isGateType(checker.getNonNullableType(type))) takesGate = true;
    if (name && ORG_PARAM_NAMES.has(name)) takesOrg = true;
    if (name && ACTOR_PARAM_NAMES.has(name)) takesActor = true;
    if (typeHasProperty(checker, checker.getNonNullableType(type), ORG_PROPERTY_NAMES)) {
      takesOrg = true;
    }
    if (typeHasProperty(checker, checker.getNonNullableType(type), ACTOR_PROPERTY_NAMES)) {
      takesActor = true;
    }
  }
  return { takesOrg, takesActor, takesGate };
}

/** True if `fn` reaches one of CHECKS through any function of this package it calls. */
function reachesCheck(
  checker: ts.TypeChecker,
  root: ts.Node,
  memo: Map<ts.Node, boolean>,
): boolean {
  const cached = memo.get(root);
  if (cached !== undefined) return cached;
  memo.set(root, false);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    // A membership read written in place (`schema.memberships`) is the same check, inlined.
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'memberships' &&
      isReadSource(node)
    ) {
      const symbol = resolve(checker, checker.getSymbolAtLocation(node.name));
      if (
        (symbol?.declarations ?? []).some((d) => real(d.getSourceFile().fileName) === schemaFile)
      ) {
        found = true;
        return;
      }
    }
    if (ts.isCallExpression(node) || ts.isIdentifier(node)) {
      const target = ts.isCallExpression(node) ? node.expression : node;
      const named = ts.isPropertyAccessExpression(target) ? target.name : target;
      const symbol = resolve(checker, checker.getSymbolAtLocation(named));
      for (const decl of symbol?.declarations ?? []) {
        if (!inServices(decl)) continue;
        const name = declarationName(decl);
        if (name && CHECKS.has(`${moduleId(decl.getSourceFile().fileName)}#${name}`)) {
          // A check counts only when it is asked about the acting person, not about someone else
          // (an assignee, a recipient).
          if (ts.isCallExpression(node) && node.arguments.some(mentionsActor)) {
            found = true;
            return;
          }
          continue;
        }
        for (const inner of functionsOf(decl)) {
          if (inner !== root && reachesCheck(checker, inner, memo)) {
            found = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  if (ts.isFunctionDeclaration(root) || ts.isArrowFunction(root) || ts.isFunctionExpression(root)) {
    if (root.body) visit(root.body);
  } else {
    visit(root);
  }
  memo.set(root, found);
  return found;
}

interface Judged {
  readonly id: string;
  readonly ok: boolean;
  readonly why: string;
}

function judgeAll(program: ts.Program): {
  readonly judged: Judged[];
  readonly entryExports: Set<ts.Node>;
} {
  const checker = program.getTypeChecker();
  const memo = new Map<ts.Node, boolean>();
  const judged: Judged[] = [];
  for (const sf of program.getSourceFiles()) {
    const file = real(sf.fileName);
    if (!file.startsWith(srcDir + path.sep) || isTestFile(file)) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const target = resolve(checker, exported);
      for (const decl of target?.declarations ?? []) {
        // Re-exports are judged where they are declared.
        if (decl.getSourceFile() !== sf) continue;
        for (const fn of functionsOf(decl)) {
          const shape = shapeOf(checker, fn);
          if (!shape.takesOrg) continue;
          const id = `${moduleId(sf.fileName)}#${exported.name}`;
          if (CHECKS.has(id)) {
            judged.push({ id, ok: true, why: 'is one of the checks' });
          } else if (shape.takesGate) {
            judged.push({ id, ok: true, why: 'takes a gate type' });
          } else if (!shape.takesActor) {
            judged.push({ id, ok: false, why: 'takes an organization id but no actor' });
          } else if (!reachesCheck(checker, fn, memo)) {
            judged.push({ id, ok: false, why: 'takes an actor but never checks its membership' });
          } else {
            judged.push({ id, ok: true, why: 'checks the actor' });
          }
        }
      }
    }
  }

  const entryExports = new Set<ts.Node>();
  const entry = program.getSourceFiles().find((s) => real(s.fileName) === indexFile);
  const entrySymbol = entry ? checker.getSymbolAtLocation(entry) : undefined;
  if (!entrySymbol) throw new Error('src/index.ts is not in the program');
  for (const exported of checker.getExportsOfModule(entrySymbol)) {
    for (const decl of resolve(checker, exported)?.declarations ?? []) entryExports.add(decl);
  }
  return { judged, entryExports };
}

function entryExportsId(entryExports: Set<ts.Node>, id: string): boolean {
  for (const decl of entryExports) {
    const name = declarationName(decl);
    if (name && `${moduleId(decl.getSourceFile().fileName)}#${name}` === id) return true;
  }
  return false;
}

/** `schema.memberships` used as what a query reads from (`.from(...)` or a join), not written. */
function isReadSource(node: ts.Node): boolean {
  const call = node.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(node as ts.Expression)) {
    return false;
  }
  const callee = call.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ['from', 'innerJoin', 'leftJoin'].includes(callee.name.text)
  );
}

describe('organization actor ratchet', () => {
  const program = loadProgram();
  const { judged, entryExports } = judgeAll(program);
  const byId = new Map<string, Judged[]>();
  for (const j of judged) byId.set(j.id, [...(byId.get(j.id) ?? []), j]);

  it('finds the functions it is meant to judge', () => {
    // A guard against the ratchet silently judging nothing (a renamed parameter, a moved file).
    for (const id of [
      'agency#listTasksForOrg',
      'agency#listNotes',
      'agency#createTaskForOrg',
      'access-ends#listAccessEndsForOrg',
      'missions#listSelectedEvidenceForOrg',
    ]) {
      expect(byId.has(id), id).toBe(true);
    }
  });

  it('every exported function told an organization takes an actor and checks it', () => {
    const failing = judged
      .filter((j) => !j.ok && ORG_ACTOR_EXCEPTIONS[j.id] === undefined)
      .map((j) => `${j.id}: ${j.why}`);
    expect(failing).toEqual([]);
  });

  it('every exception is still needed, and every internal one is kept off the package entry', () => {
    const problems: string[] = [];
    for (const [id, exception] of Object.entries(ORG_ACTOR_EXCEPTIONS)) {
      const found = byId.get(id);
      if (!found) {
        problems.push(`${id}: no longer exists or no longer takes an organization`);
        continue;
      }
      if (found.every((j) => j.ok)) problems.push(`${id}: now checks the actor; remove it`);
      if (exception.reason.trim().length < 20) problems.push(`${id}: give a real reason`);
      if (exception.kind === 'internal' && entryExportsId(entryExports, id)) {
        problems.push(`${id}: internal, but exported from src/index.ts`);
      }
    }
    expect(problems).toEqual([]);
  });
});
