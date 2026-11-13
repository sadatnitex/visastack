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
 * - "Checks that person": unless a gate type is taken, the function must ask one of the existing
 *   membership checks about the acting person, directly or through functions of this package it
 *   hands the person to: `isActiveMember`, `isOrgAdmin`, `isMember` or `mayReadOrgCase` (second
 *   argument), or for a platform staff action `isPlatformOwner`, `hasAnyPlatformRole` or
 *   `canPerformPlatformAction`. There is no second permission model.
 * - "The acting person" is bound to the function's OWN actor parameters, by symbol, not by name: a
 *   direct `actor`, `actorAccountId`, `accountId` or `principal` parameter (or the same destructured),
 *   or the `actorAccountId` / `actor` property of an input object. Only when a function has no
 *   direct actor parameter is the `accountId` of its one object parameter the person (the
 *   `fields.accountId` of the access helpers). Copies of the person into a local count; a recipient's
 *   `accountId`, a local that merely has that name, and a helper's parameter that was handed some
 *   other id do not. A helper counts only for the parameters it was given the person in.
 * - The only membership read accepted IN PLACE, without calling one of those checks, is a read of
 *   `schema.memberships` (`.from(...)` or a join) whose same query expression (the whole
 *   `await db.select()...from(...)...where(...)` chain) contains the acting person. A read with no
 *   person in it fails. A `SelfScope` is not a gate here (it proves a person for their own records,
 *   not a membership of an organization).
 * - What this does NOT prove: that the function acts on the answer (a check whose result is ignored
 *   passes), or that the check is about the same organization the function is given (the check's
 *   third argument is not bound). Review and the stranger matrices cover those.
 *
 * Anything else must be listed in org-actor-exceptions.json with its kind and a reason a reviewer
 * reads (a data file, so the list is not source that other source guards scan).
 *
 * Kinds: `internal` (never exported from the package entry, held below, so only this package can
 * call it, after its own check of the person), `pure` (reads nothing), `staff` (a platform staff
 * action whose web route checks the staff permission first), `display` (the agency's public name
 * and logo), `caller-checked` (called only after the caller's own membership or staff check; named
 * so the next change to it moves the check into the service). The list is fixed, not a baseline.
 * An `internal` exception must not be exported from the package entry (src/index.ts), so the web app and the other packages cannot call it. An exception that is no longer needed, or
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
const probeFile = path.join(accessDir, 'org-actor-probes.test-support.ts');
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
  return file.startsWith(srcDir + path.sep) && (!isTestFile(file) || file === probeFile);
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
  // The probe fixtures are test support (kept out of the package pass) but are in the program, so
  // the self-tests can judge them with the same checker.
  const rootNames = parsed.fileNames.filter((f) => !isTestFile(f) || real(f) === probeFile);
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

/**
 * What counts as "the acting person" inside one function: the symbols of its own parameters (or
 * locals copied from them). A scalar symbol is the person's id itself (`actorAccountId`); an object
 * symbol carries it in the named properties (`input.actorAccountId`). Bound to symbols, so a
 * recipient's `accountId`, a local that merely has the same name, or a helper's parameter that was
 * handed someone else's id never counts.
 */
interface ActorSym {
  readonly kind: 'scalar' | 'object';
  readonly props: ReadonlySet<string>;
}
type ActorSyms = Map<ts.Symbol, ActorSym>;

const SCALAR: ActorSym = { kind: 'scalar', props: new Set() };
const DIRECT_PROPS = ['actorAccountId', 'actor'];

function symbolOf(checker: ts.TypeChecker, id: ts.Identifier): ts.Symbol | undefined {
  if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) {
    return checker.getShorthandAssignmentValueSymbol(id.parent);
  }
  return checker.getSymbolAtLocation(id);
}

/** The function's own actor parameters. A direct `actorAccountId`-like parameter wins: then an object's `accountId` is not the actor (it is a recipient, an assignee). */
function actorSymbols(checker: ts.TypeChecker, fn: FunctionLike): ActorSyms {
  const syms: ActorSyms = new Map();
  for (const param of fn.parameters) {
    if (ts.isIdentifier(param.name)) {
      const symbol = checker.getSymbolAtLocation(param.name);
      if (symbol && ACTOR_PARAM_NAMES.has(param.name.text)) syms.set(symbol, SCALAR);
    } else if (ts.isObjectBindingPattern(param.name)) {
      for (const element of param.name.elements) {
        const key = (element.propertyName ?? element.name) as ts.Node;
        const symbol = ts.isIdentifier(element.name)
          ? checker.getSymbolAtLocation(element.name)
          : undefined;
        if (symbol && ts.isIdentifier(key) && DIRECT_PROPS.includes(key.text)) {
          syms.set(symbol, SCALAR);
        }
      }
    }
  }
  const direct = syms.size > 0;
  const props = direct ? DIRECT_PROPS : ACTOR_PROPERTY_NAMES;
  for (const param of fn.parameters) {
    if (!ts.isIdentifier(param.name)) continue;
    const symbol = checker.getSymbolAtLocation(param.name);
    if (!symbol || syms.has(symbol)) continue;
    const type = checker.getNonNullableType(checker.getTypeAtLocation(param));
    if (typeHasProperty(checker, type, props)) {
      syms.set(symbol, { kind: 'object', props: new Set(props) });
    }
  }
  return syms;
}

/** True if `node` is, or contains, the acting person as bound in `syms`. */
function mentions(checker: ts.TypeChecker, node: ts.Node, syms: ActorSyms): boolean {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const info = syms.get(symbolOf(checker, node.expression) as ts.Symbol);
    if (info && (info.kind === 'scalar' || info.props.has(node.name.text))) return true;
    return false;
  }
  if (ts.isIdentifier(node)) {
    const info = syms.get(symbolOf(checker, node) as ts.Symbol);
    return info?.kind === 'scalar';
  }
  return (
    ts.forEachChild(node, (child) => (mentions(checker, child, syms) ? true : undefined)) === true
  );
}

/** Which of an object literal's properties carry the actor. */
function actorProps(checker: ts.TypeChecker, literal: ts.ObjectLiteralExpression, syms: ActorSyms) {
  const names = new Set<string>();
  for (const property of literal.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      if (mentions(checker, property.name, syms)) names.add(property.name.text);
    } else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      if (mentions(checker, property.initializer, syms)) names.add(property.name.text);
    }
  }
  return names;
}

/** `schema.memberships` read from in place (`.from(...)` or a join), not written. */
function isMembershipsRead(checker: ts.TypeChecker, node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'memberships') return false;
  const call = node.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(node as ts.Expression)) {
    return false;
  }
  const callee = call.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !['from', 'innerJoin', 'leftJoin'].includes(callee.name.text)
  ) {
    return false;
  }
  const symbol = resolve(checker, checker.getSymbolAtLocation(node.name));
  return (symbol?.declarations ?? []).some((d) => real(d.getSourceFile().fileName) === schemaFile);
}

/** The whole query expression a read sits in (`await db.select()...from(...)...where(...)`). */
function queryChain(node: ts.Node): ts.Node {
  let top = node;
  while (
    top.parent &&
    (ts.isCallExpression(top.parent) ||
      ts.isPropertyAccessExpression(top.parent) ||
      ts.isAwaitExpression(top.parent) ||
      ts.isParenthesizedExpression(top.parent))
  ) {
    top = top.parent;
  }
  return top;
}

/**
 * True if `root` checks the person in `syms` against an organization: it asks one of CHECKS about
 * that person (second argument), or reads the memberships table with the person in the same query,
 * directly or through functions of this package it hands the person to. The person is followed by
 * binding: a helper counts only for the parameters it was actually given the person in.
 */
function reachesCheck(
  checker: ts.TypeChecker,
  root: FunctionLike,
  rootSyms: ActorSyms,
  memo: Map<string, boolean>,
): boolean {
  const key = `${real(root.getSourceFile().fileName)}:${root.pos}:${[...rootSyms.values()]
    .map((v) => `${v.kind}${[...v.props].sort().join('+')}`)
    .join(',')}:${rootSyms.size}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  memo.set(key, false);
  const syms: ActorSyms = new Map(rootSyms);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (isMembershipsRead(checker, node) && mentions(checker, queryChain(node), syms)) {
      found = true;
      return;
    }
    // A local that copies the person (`const who = actorAccountId`, `const { actorAccountId } = input`).
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && mentions(checker, node.initializer, syms)) syms.set(symbol, SCALAR);
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        ts.isIdentifier(node.initializer) &&
        syms.get(checker.getSymbolAtLocation(node.initializer) as ts.Symbol)?.kind === 'object'
      ) {
        const info = syms.get(checker.getSymbolAtLocation(node.initializer) as ts.Symbol);
        for (const element of node.name.elements) {
          const keyNode = (element.propertyName ?? element.name) as ts.Node;
          const symbol = ts.isIdentifier(element.name)
            ? checker.getSymbolAtLocation(element.name)
            : undefined;
          if (symbol && ts.isIdentifier(keyNode) && info?.props.has(keyNode.text)) {
            syms.set(symbol, SCALAR);
          }
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      const named = ts.isPropertyAccessExpression(target) ? target.name : target;
      const symbol = resolve(checker, checker.getSymbolAtLocation(named));
      for (const decl of symbol?.declarations ?? []) {
        if (!inServices(decl)) continue;
        const name = declarationName(decl);
        if (name && CHECKS.has(`${moduleId(decl.getSourceFile().fileName)}#${name}`)) {
          // The check must be about the acting person: its second argument, never someone else's.
          const subject = node.arguments[1];
          if (subject && mentions(checker, subject, syms)) {
            found = true;
            return;
          }
          continue;
        }
        for (const inner of functionsOf(decl)) {
          if (inner === root) continue;
          const given: ActorSyms = new Map();
          inner.parameters.forEach((param, index) => {
            const arg = node.arguments[index];
            if (!arg) return;
            if (ts.isIdentifier(param.name)) {
              const innerSymbol = checker.getSymbolAtLocation(param.name);
              if (!innerSymbol) return;
              const argInfo = ts.isIdentifier(arg)
                ? syms.get(symbolOf(checker, arg) as ts.Symbol)
                : undefined;
              if (argInfo?.kind === 'object') given.set(innerSymbol, argInfo);
              else if (ts.isObjectLiteralExpression(arg)) {
                const names = actorProps(checker, arg, syms);
                if (names.size > 0) given.set(innerSymbol, { kind: 'object', props: names });
              } else if (mentions(checker, arg, syms)) given.set(innerSymbol, SCALAR);
            } else if (ts.isObjectBindingPattern(param.name) && ts.isObjectLiteralExpression(arg)) {
              const names = actorProps(checker, arg, syms);
              for (const element of param.name.elements) {
                const keyNode = (element.propertyName ?? element.name) as ts.Node;
                const innerSymbol = ts.isIdentifier(element.name)
                  ? checker.getSymbolAtLocation(element.name)
                  : undefined;
                if (innerSymbol && ts.isIdentifier(keyNode) && names.has(keyNode.text)) {
                  given.set(innerSymbol, SCALAR);
                }
              }
            }
          });
          if (given.size > 0 && reachesCheck(checker, inner, given, memo)) {
            found = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  if (root.body) visit(root.body);
  memo.set(key, found);
  return found;
}

interface Judged {
  readonly id: string;
  readonly ok: boolean;
  readonly why: string;
}

/** `package`: every non-test module of the package. `probes`: only the probe fixtures. */
function judgeAll(
  program: ts.Program,
  scope: 'package' | 'probes' = 'package',
): {
  readonly judged: Judged[];
  readonly entryExports: Set<ts.Node>;
} {
  const checker = program.getTypeChecker();
  const memo = new Map<string, boolean>();
  const judged: Judged[] = [];
  for (const sf of program.getSourceFiles()) {
    const file = real(sf.fileName);
    if (!file.startsWith(srcDir + path.sep)) continue;
    if (scope === 'probes' ? file !== probeFile : isTestFile(file)) continue;
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
          } else if (!reachesCheck(checker, fn, actorSymbols(checker, fn), memo)) {
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

/**
 * The ratchet judged against small fixtures (org-actor-probes.test-support.ts): each function that
 * must be refused is refused, each that must pass passes. Without these, a looser rule would go
 * unnoticed, because every real function that passes today checks the right account.
 */
describe('organization actor ratchet, self-tests on probe fixtures', () => {
  const program = loadProgram();
  const probes = new Map(judgeAll(program, 'probes').judged.map((j) => [j.id.split('#')[1], j]));
  const REFUSED = [
    'probeWrongAccount',
    'probeLocalAccountId',
    'probeNoActor',
    'probeMembershipsAnyone',
    'probeWrongAccountViaHelper',
    'probeAliasOfOther',
  ];
  const ACCEPTED = [
    'probeDirect',
    'probeObjectInput',
    'probeDestructured',
    'probeViaHelper',
    'probeAlias',
    'probeInlineRead',
    'probeFieldsAccountId',
  ];

  it('judges every fixture', () => {
    expect([...probes.keys()].sort()).toEqual([...REFUSED, ...ACCEPTED].sort());
  });

  it.each(REFUSED)('refuses %s', (name) => {
    expect(probes.get(name)?.ok, probes.get(name)?.why).toBe(false);
  });

  it.each(ACCEPTED)('accepts %s', (name) => {
    expect(probes.get(name)?.ok, probes.get(name)?.why).toBe(true);
  });
});
