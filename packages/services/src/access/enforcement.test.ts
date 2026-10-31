import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Ratchet: every exported service function that reads or writes an
 * applicant-owned table must take a gate type (`AuthorizedApplicant`,
 * `SystemScope` or `StaffScope`) as a parameter, or be listed in
 * `enforcement-baseline.json`. The baseline can only shrink: a new violation
 * fails, and so does a baseline entry that now complies or no longer exists.
 *
 * - A bare `Principal` does not count: anyone can name an account id, so it
 *   proves nothing. Only access/ (the gate itself) takes one.
 * - Calling an exported function that is itself ungated counts as touching
 *   the table, so a new function cannot reach applicant data through an
 *   older, baselined one.
 * - An export built by wrapping a function (`export const f = wrap(async ...)`)
 *   is judged by the functions it wraps.
 * - `systemPrincipal` (a scheduled job's scope) may only be used by the job
 *   routes in apps/web/src/app/api/jobs.
 * - `selfPrincipal` (the signed-in person's scope over their own records, ADR
 *   0025) may only be used by `withSession` in apps/web/src/lib/session.ts.
 *
 * Everything here is resolved through the TypeScript type checker, not text:
 * a table counts only if the identifier resolves to the table's declaration in
 * packages/db/src/schema.ts, and a parameter counts only if its type resolves
 * to the gate type declared in access/. A comment or a same-named local type
 * cannot satisfy it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const servicesDir = realpathSync(path.resolve(here, '../..'));
const srcDir = path.join(servicesDir, 'src');
const accessDir = path.join(srcDir, 'access');
const schemaFile = realpathSync(path.resolve(servicesDir, '../db/src/schema.ts'));
const baselineFile = path.join(accessDir, 'enforcement-baseline.json');

/** A table is applicant-owned when it has any of these columns. */
const OWNED_COLUMNS = new Set([
  'applicant_id',
  'mission_id',
  'document_id',
  'document_version_id',
  'owner_account_id',
]);
const GATE_TYPES = ['AuthorizedApplicant', 'SystemScope', 'StaffScope'] as const;

/**
 * ADR 0025: the person billing tables (a person's own plan, invoices, payments and receipts) are
 * declared in person-billing-tables.ts. Every exported function that touches one must take a
 * `SelfScope` (the signed-in person, for their own rows), a `StaffScope` or a `SystemScope`.
 */
const personTablesFile = path.join(srcDir, 'person-billing-tables.ts');
const PERSON_GATE_TYPES = ['SelfScope', 'StaffScope', 'SystemScope'] as const;
/**
 * The only modules that may name the 0110 payer column in plain text: the declarations, and T2's
 * plain-SQL readers, whose exported functions are listed in PERSON_EXCEPTIONS.
 */
const PAYER_COLUMN_MODULES = [
  'person-billing-tables',
  'traveller-billing',
  'person-billing',
  'person-billing-history',
  'invoice-ledger',
  // T4: the daily run's person step reads current subscriptions in plain SQL.
  'person-renewals',
  // T6: the accounting file reads an invoice's payer for its reference code (StaffScope gated).
  'ledger-export',
  // T6: a person's refund (below its marker) and the owner's Traveller Billing view.
  'refunds',
  'person-billing-admin',
] as const;
/**
 * Exported functions that touch person billing tables without a gate and are trusted not to
 * spread to their callers, each with why (ADR 0025). Fixed, like PERSON_EXCEPTIONS.
 */
const PERSON_TRUSTED: Readonly<Record<string, string>> = {
  'invoice-ledger#applyInvoiceCollection':
    "the one recording function (ADR 0020): its person steps are private to it and act only on the locked invoice's own payer; its agency callers prove the money (gateway validation, staff, claims) as before",
};
/**
 * ADR 0025: a `SelfScope` also gates the applicant ratchet, but only for a function that reaches
 * applicant-owned tables through these calls alone (an audit record is written, nothing of anyone's
 * record is read). A function taking only a `SelfScope` that touches an applicant-owned table
 * itself, or through any other ungated function, is a violation.
 */
const SELF_SAFE_CALLS: ReadonlySet<string> = new Set([
  'audit#appendAuditEvent',
  // T4: takes the SelfScope itself and cancels only still-queued notices addressed to that
  // person's own account (Stop Renewing); reads nothing back. Its test: person-renewals.test.ts.
  'notifications#cancelOwnQueuedNotifications',
]);
/**
 * Exported person billing functions that take no gate, each with why. Fixed, not a baseline: a new
 * function cannot be added here without a reason a reviewer reads, and an entry that no longer
 * exists fails the test.
 */
const PERSON_EXCEPTIONS: Readonly<Record<string, string>> = {
  'traveller-billing#personBillingPresent':
    'reads only whether migration 0110 ran (information_schema), no billing row',
  'traveller-billing#coveringPaidPeriod':
    "the entitlement resolver's coverage check for the account the caller already acts as; returns a plan id and dates, never a billing row (ADR 0025 section 13)",
  'traveller-billing#paidTravellerCoverage':
    'counts people per plan for the owner-only Plans page; returns counts, never a billing row',
};
const webSrcDir = path.resolve(servicesDir, '../../apps/web/src');
const jobsDir = path.join(webSrcDir, 'app', 'api', 'jobs');

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

function loadProgram(): { program: ts.Program; configFileNames: readonly string[] } {
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
  // Every non-test module, not only those reachable from index.ts, so a
  // module that is never re-exported cannot slip past the rule.
  const rootNames = parsed.fileNames.filter((f) => !isTestFile(f));
  const program = ts.createProgram({ rootNames, options: { ...parsed.options, noEmit: true } });
  return { program, configFileNames: parsed.fileNames };
}

function sourceFileAt(program: ts.Program, fileName: string): ts.SourceFile {
  const sf = program.getSourceFiles().find((s) => real(s.fileName) === fileName);
  if (!sf) throw new Error(`not in the program: ${fileName}`);
  return sf;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function unwrapExpression(node: ts.Node): ts.Node {
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

/** The column object of a `pgTable('name', { ... })` or `pgTable('name', (t) => ({ ... }))` call. */
function columnObject(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
  const arg = call.arguments[1];
  if (!arg) return undefined;
  const unwrapped = unwrapExpression(arg);
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped;
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    const body = unwrapExpression(unwrapped.body);
    if (ts.isObjectLiteralExpression(body)) return body;
  }
  return undefined;
}

/** Every string literal passed as the first argument of a call inside `node` (a column builder's SQL name). */
function columnNames(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const firstArg = n.arguments[0];
      if (firstArg && ts.isStringLiteralLike(firstArg)) names.push(firstArg.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** Declaration nodes of every exported table in schema.ts that has an applicant-owned column. */
function ownedTables(schemaSf: ts.SourceFile): { decls: Set<ts.Node>; names: Set<string> } {
  const decls = new Set<ts.Node>();
  const names = new Set<string>();
  let tableCount = 0;
  for (const statement of schemaSf.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
      const init = unwrapExpression(decl.initializer);
      if (!ts.isCallExpression(init)) continue;
      const callee = init.expression;
      if (!ts.isIdentifier(callee) || callee.text !== 'pgTable') continue;
      tableCount += 1;
      const columns = columnObject(init);
      if (!columns) throw new Error(`unrecognised pgTable shape for ${decl.name.text}`);
      const owned = columns.properties.some(
        (prop) =>
          ts.isPropertyAssignment(prop) &&
          columnNames(prop.initializer).some((name) => OWNED_COLUMNS.has(name)),
      );
      if (owned) {
        decls.add(decl);
        names.add(decl.name.text);
      }
    }
  }
  if (tableCount === 0) throw new Error('found no pgTable declarations in schema.ts');
  return { decls, names };
}

/** Every exported `pgTable` of a declarations file (person-billing-tables.ts: all of them count). */
function allTables(sf: ts.SourceFile): { decls: Set<ts.Node>; names: Set<string> } {
  const decls = new Set<ts.Node>();
  const names = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
      const init = unwrapExpression(decl.initializer);
      if (!ts.isCallExpression(init)) continue;
      const callee = init.expression;
      if (!ts.isIdentifier(callee) || callee.text !== 'pgTable') continue;
      decls.add(decl);
      names.add(decl.name.text);
    }
  }
  if (decls.size === 0) throw new Error(`found no pgTable declarations in ${sf.fileName}`);
  return { decls, names };
}

function resolve(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) return checker.getAliasedSymbol(symbol);
  return symbol;
}

function gateDeclarations(
  program: ts.Program,
  checker: ts.TypeChecker,
  types: readonly string[] = GATE_TYPES,
): Set<ts.Node> {
  const decls = new Set<ts.Node>();
  const found = new Set<string>();
  for (const file of ['principal.ts', 'require-access.ts']) {
    const sf = sourceFileAt(program, path.join(accessDir, file));
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) throw new Error(`no module symbol for ${file}`);
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      if (!types.includes(exported.name)) continue;
      for (const decl of resolve(checker, exported)?.declarations ?? []) decls.add(decl);
      found.add(exported.name);
    }
  }
  for (const name of types) {
    if (!found.has(name)) throw new Error(`gate type ${name} not found in access/`);
  }
  return decls;
}

function isGateType(type: ts.Type, gateDecls: Set<ts.Node>): boolean {
  // The class itself (`typeof AuthorizedApplicant`) is not a proof: only an instance is.
  if (type.getConstructSignatures().length > 0) return false;
  const symbols = [type.aliasSymbol, type.getSymbol()];
  if (symbols.some((s) => (s?.declarations ?? []).some((d) => gateDecls.has(d)))) return true;
  // A union of gate types (for example SystemScope | StaffScope) counts; a
  // union that admits undefined or anything else does not.
  if (type.isUnion()) return type.types.every((t) => isGateType(t, gateDecls));
  return false;
}

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

interface ExportShape {
  /** The functions whose parameters decide compliance (every one must take a gate). */
  readonly fns: FunctionLike[];
  /** The nodes scanned for applicant-owned tables. */
  readonly roots: ts.Node[];
  /**
   * The export cannot be judged by its parameters (a class, `export const f = g`,
   * `g.bind(...)`, a call returning a function): if it reaches applicant data it
   * fails, because the ratchet cannot see a gate on it.
   */
  readonly opaque: boolean;
}

function exportedFunctions(checker: ts.TypeChecker, sf: ts.SourceFile): Map<string, ExportShape> {
  const result = new Map<string, ExportShape>();
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) return result;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const target = resolve(checker, exported);
    const fns: FunctionLike[] = [];
    const roots: ts.Node[] = [];
    let opaque = false;
    for (const decl of target?.declarations ?? []) {
      // Re-exports are judged in the module that declares them.
      if (decl.getSourceFile() !== sf) continue;
      if (ts.isFunctionDeclaration(decl)) {
        fns.push(decl);
        roots.push(decl);
      } else if (ts.isClassDeclaration(decl)) {
        opaque = true;
        roots.push(decl);
      } else if (ts.isVariableDeclaration(decl) && decl.initializer) {
        const init = unwrapExpression(decl.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          fns.push(init);
          roots.push(init);
        } else if (
          checker.getTypeAtLocation(decl).getCallSignatures().length > 0 ||
          ts.isCallExpression(init)
        ) {
          const wrapped = ts.isCallExpression(init) ? wrappedFunctions(init) : [];
          if (wrapped.length > 0) fns.push(...wrapped);
          else opaque = true;
          roots.push(init);
        }
      }
    }
    if (roots.length > 0) result.set(exported.name, { fns, roots, opaque });
  }
  return result;
}

/** The functions passed, at any depth, into a wrapping call such as `wrap(async () => ...)`. */
function wrappedFunctions(call: ts.CallExpression): FunctionLike[] {
  const found: FunctionLike[] = [];
  for (const arg of call.arguments) {
    const unwrapped = unwrapExpression(arg);
    if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) found.push(unwrapped);
    else if (ts.isCallExpression(unwrapped)) found.push(...wrappedFunctions(unwrapped));
  }
  return found;
}

/** Local names in `sf` that import an owned table under another name. */
function importedTableAliases(sf: ts.SourceFile, tableNames: Set<string>): Set<string> {
  const aliases = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (tableNames.has(imported)) aliases.add(element.name.text);
    }
  }
  return aliases;
}

/**
 * Module-level names that stand for an owned table: `const docs = schema.documents`
 * and `const { documents } = schema`. A destructured name spelled like a table
 * counts whatever it came from (fails closed).
 */
function moduleTableAliases(
  sf: ts.SourceFile,
  tableNames: Set<string>,
  tableDecls: Set<ts.Node>,
  checker: ts.TypeChecker,
): { names: Set<string>; decls: Set<ts.Node> } {
  const names = new Set<string>();
  const decls = new Set<ts.Node>();
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isObjectBindingPattern(decl.name)) {
        for (const element of decl.name.elements) {
          const property = element.propertyName ?? element.name;
          if (
            ts.isIdentifier(property) &&
            tableNames.has(property.text) &&
            ts.isIdentifier(element.name)
          ) {
            names.add(element.name.text);
            decls.add(element);
          }
        }
        continue;
      }
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const init = unwrapExpression(decl.initializer);
      const named = ts.isPropertyAccessExpression(init) ? init.name : init;
      if (!ts.isIdentifier(named) || !tableNames.has(named.text)) continue;
      const symbol = resolve(checker, checker.getSymbolAtLocation(named));
      if ((symbol?.declarations ?? []).some((d) => tableDecls.has(d))) {
        names.add(decl.name.text);
        decls.add(decl);
      }
    }
  }
  return { names, decls };
}

/** Local name to imported name for each `import { a as b }` in `sf`. */
function renamedImports(sf: ts.SourceFile): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.propertyName) aliases.set(element.name.text, element.propertyName.text);
    }
  }
  return aliases;
}

/** Top-level, non-exported functions of `sf` by name: private helpers an exported function may delegate to. */
function privateHelpers(sf: ts.SourceFile): Map<string, ts.Node[]> {
  const helpers = new Map<string, ts.Node[]>();
  const add = (name: string, node: ts.Node): void => {
    helpers.set(name, [...(helpers.get(name) ?? []), node]);
  };
  for (const statement of sf.statements) {
    if (hasExportModifier(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      add(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = unwrapExpression(decl.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) add(decl.name.text, decl);
      }
    }
  }
  return helpers;
}

interface FileScan {
  readonly checker: ts.TypeChecker;
  readonly tableDecls: Set<ts.Node>;
  /** Table names plus renamed table imports in this file. */
  readonly candidateNames: Set<string>;
  readonly helpers: Map<string, ts.Node[]>;
  /** Memo per private helper declaration; `false` while in progress breaks recursion. */
  readonly memo: Map<ts.Node, boolean>;
  /** Names and declarations of exported functions found ungated so far, in any module. */
  readonly ungatedNames: Set<string>;
  readonly ungatedDecls: Set<ts.Node>;
  /** Local name to imported name, for every renamed named import in this file. */
  readonly importAliases: Map<string, string>;
}

/**
 * True if `root` (its body, nested functions, and any private helper of the
 * same module it reaches, transitively) resolves an applicant-owned table.
 * Exported helpers are not followed: each is judged on its own.
 */
function touchesOwnedTable(scan: FileScan, root: ts.Node): boolean {
  let touches = false;
  const visit = (node: ts.Node): void => {
    if (touches) return;
    // Only identifiers spelled like a table, a renamed table import, or a
    // private helper are resolved, which keeps the checker away from
    // unrelated expressions.
    // `db.query.documents` (the relational query API) and `schema['documents']`.
    if (
      ts.isPropertyAccessExpression(node) &&
      scan.candidateNames.has(node.name.text) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'query'
    ) {
      touches = true;
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      scan.candidateNames.has(node.argumentExpression.text)
    ) {
      touches = true;
      return;
    }
    if (ts.isIdentifier(node)) {
      if (
        scan.candidateNames.has(node.text) ||
        scan.ungatedNames.has(node.text) ||
        scan.ungatedNames.has(scan.importAliases.get(node.text) ?? '')
      ) {
        const symbol = resolve(scan.checker, scan.checker.getSymbolAtLocation(node));
        if (
          (symbol?.declarations ?? []).some(
            (d) => scan.tableDecls.has(d) || scan.ungatedDecls.has(d),
          )
        ) {
          touches = true;
          return;
        }
      }
      const helperDecls = scan.helpers.get(node.text);
      if (helperDecls) {
        const symbol = resolve(scan.checker, scan.checker.getSymbolAtLocation(node));
        for (const decl of symbol?.declarations ?? []) {
          if (!helperDecls.includes(decl)) continue;
          let result = scan.memo.get(decl);
          if (result === undefined) {
            scan.memo.set(decl, false);
            result = touchesOwnedTable(scan, decl);
            scan.memo.set(decl, result);
          }
          if (result) {
            touches = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return touches;
}

function complies(checker: ts.TypeChecker, fns: FunctionLike[], gateDecls: Set<ts.Node>): boolean {
  // Every overload and every wrapped function must take a gate, not just one of them.
  return (
    fns.length > 0 &&
    fns.every((fn) =>
      fn.parameters.some(
        (param) =>
          param.questionToken === undefined &&
          param.initializer === undefined &&
          isGateType(checker.getTypeAtLocation(param), gateDecls),
      ),
    )
  );
}

interface Analysis {
  readonly violations: Set<string>;
  readonly exportedFunctionIds: Set<string>;
  readonly ownedTableNames: Set<string>;
  readonly systemScopeUsers: string[];
  readonly selfScopeUsers: string[];
}

function sourceFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
    files.push(path.join(entry.parentPath, entry.name));
  }
  return files;
}

/**
 * Files outside access/ and the job routes that mention `systemPrincipal`.
 * Plain text on purpose: a comment or a renamed import fails closed too. The
 * services index re-exports it and is the one allowed exception.
 */
function systemScopeUsers(serviceFiles: readonly string[]): string[] {
  const indexFile = path.join(srcDir, 'index.ts');
  const users: string[] = [];
  for (const file of [...serviceFiles.map(real), ...sourceFilesUnder(webSrcDir)]) {
    if (file.startsWith(accessDir + path.sep) || file === indexFile) continue;
    if (file.startsWith(jobsDir + path.sep)) continue;
    if (/\bsystemPrincipal\b/.test(readFileSync(file, 'utf8'))) {
      users.push(path.relative(path.resolve(servicesDir, '../..'), file).replace(/\\/g, '/'));
    }
  }
  return users.sort();
}

const repoDir = realpathSync(path.resolve(servicesDir, '../..'));
/** Folders never holding code that runs: dependencies, build output, docs. */
const NOT_CODE = new Set(['node_modules', '.next', '.turbo', '.git', 'dist', 'coverage', 'docs']);

/** Every code file of the repository (any package or app, scripts and tests included). */
function codeFilesOfRepo(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NOT_CODE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(repoDir);
  return files;
}

/**
 * Code files anywhere in the repository (every package and app, scripts included) that mention
 * `selfPrincipal`, other than access/, the services index that re-exports it, and
 * apps/web/src/lib/session.ts. Plain text on purpose, as above. Tests are left out: a test may
 * stand in for it, and tests never run in production.
 */
function selfScopeUsers(): string[] {
  const indexFile = path.join(srcDir, 'index.ts');
  const sessionFile = path.join(webSrcDir, 'lib', 'session.ts');
  const users: string[] = [];
  for (const file of codeFilesOfRepo().map(real)) {
    if (file.startsWith(accessDir + path.sep) || file === indexFile || file === sessionFile) {
      continue;
    }
    if (/\.test\.(ts|tsx)$|\.test-support\.ts$|\.test-d\.ts$/.test(file)) continue;
    if (/\bselfPrincipal\b/.test(readFileSync(file, 'utf8'))) {
      users.push(path.relative(repoDir, file).replace(/\\/g, '/'));
    }
  }
  return users.sort();
}

let loaded: { program: ts.Program; configFileNames: readonly string[] } | undefined;
/** One program for both ratchets: building it is the slow part. */
function programOnce(): { program: ts.Program; configFileNames: readonly string[] } {
  loaded ??= loadProgram();
  return loaded;
}

function analyse(): Analysis {
  const { program, configFileNames } = programOnce();
  const checker = program.getTypeChecker();
  const tables = ownedTables(sourceFileAt(program, schemaFile));
  const gateDecls = gateDeclarations(program, checker);
  return {
    ...ratchet(program, checker, tables, gateDecls, {
      selfGate: {
        decls: gateDeclarations(program, checker, ['SelfScope']),
        safe: SELF_SAFE_CALLS,
      },
    }),
    ownedTableNames: tables.names,
    systemScopeUsers: systemScopeUsers(configFileNames),
    selfScopeUsers: selfScopeUsers(),
  };
}

/**
 * The exported functions (module#name) that touch one of `tables` without a parameter of a gate in
 * `gateDecls`, directly or by calling one that does.
 */
function ratchet(
  program: ts.Program,
  checker: ts.TypeChecker,
  tables: { readonly decls: Set<ts.Node>; readonly names: Set<string> },
  gateDecls: Set<ts.Node>,
  options: {
    /** Never a violation and never spread to callers (see PERSON_TRUSTED). */
    readonly trusted?: ReadonlySet<string>;
    /** A gate that counts only when the tables are reached through `safe` calls alone. */
    readonly selfGate?: { readonly decls: Set<ts.Node>; readonly safe: ReadonlySet<string> };
  } = {},
): { violations: Set<string>; exportedFunctionIds: Set<string> } {
  interface ExportedFn {
    readonly id: string;
    readonly name: string;
    readonly shape: ExportShape;
    readonly decls: ts.Node[];
    readonly scan: FileScan;
    readonly inAccess: boolean;
  }
  const ungatedNames = new Set<string>();
  const ungatedDecls = new Set<ts.Node>();
  const exported: ExportedFn[] = [];
  for (const sf of program.getSourceFiles()) {
    const fileName = real(sf.fileName);
    if (sf.isDeclarationFile || !fileName.startsWith(srcDir + path.sep) || isTestFile(fileName)) {
      continue;
    }
    const aliases = moduleTableAliases(sf, tables.names, tables.decls, checker);
    const scan: FileScan = {
      checker,
      tableDecls: new Set([...tables.decls, ...aliases.decls]),
      candidateNames: new Set([
        ...tables.names,
        ...importedTableAliases(sf, tables.names),
        ...aliases.names,
      ]),
      helpers: privateHelpers(sf),
      memo: new Map(),
      ungatedNames,
      ungatedDecls,
      importAliases: renamedImports(sf),
    };
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    for (const [name, shape] of exportedFunctions(checker, sf)) {
      const symbol = moduleSymbol
        ? checker.getExportsOfModule(moduleSymbol).find((e) => e.name === name)
        : undefined;
      exported.push({
        id: `${moduleId(fileName)}#${name}`,
        name,
        shape,
        decls: (resolve(checker, symbol)?.declarations ?? []).filter(
          (d) => d.getSourceFile() === sf,
        ),
        scan,
        inAccess: fileName.startsWith(accessDir + path.sep),
      });
    }
  }

  // Repeat until nothing new turns up: a function that calls an ungated one
  // is ungated too, unless it takes a gate itself.
  const violations = new Set<string>();
  const exportedFunctionIds = new Set(exported.map((e) => e.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const entry of exported) {
      if (violations.has(entry.id) || entry.inAccess || options.trusted?.has(entry.id)) continue;
      const self = options.selfGate;
      // A listed safe call that itself takes a SelfScope acts only on that person's own rows
      // (reviewed with its reason in SELF_SAFE_CALLS); one without a SelfScope is judged as usual.
      if (
        self?.safe.has(entry.id) &&
        !entry.shape.opaque &&
        complies(checker, entry.shape.fns, self.decls)
      ) {
        continue;
      }
      entry.scan.memo.clear();
      const touches = entry.shape.roots.some((root) => touchesOwnedTable(entry.scan, root));
      let gated = !entry.shape.opaque && complies(checker, entry.shape.fns, gateDecls);
      if (
        touches &&
        !gated &&
        self &&
        !entry.shape.opaque &&
        complies(checker, entry.shape.fns, self.decls)
      ) {
        // Gated by a SelfScope alone: allowed only if, leaving out the safe calls, it touches
        // nothing (no table of its own, no other ungated function).
        const safeEntries = exported.filter((e) => self.safe.has(e.id));
        const safeDecls = new Set(safeEntries.flatMap((e) => e.decls));
        const safeNames = new Set(safeEntries.map((e) => e.name));
        const strict: FileScan = {
          ...entry.scan,
          memo: new Map(),
          ungatedNames: new Set([...ungatedNames].filter((n) => !safeNames.has(n))),
          ungatedDecls: new Set([...ungatedDecls].filter((d) => !safeDecls.has(d))),
        };
        gated = !entry.shape.roots.some((root) => touchesOwnedTable(strict, root));
      }
      if (touches && !gated) {
        violations.add(entry.id);
        ungatedNames.add(entry.name);
        for (const decl of entry.decls) ungatedDecls.add(decl);
        changed = true;
      }
    }
  }

  return { violations, exportedFunctionIds };
}

/**
 * Code a person's billing rows could be reached through without the declarations: the 0110 payer
 * column, the person receipt counters, or a filter on an empty organization, named in text (plain
 * SQL the type-based ratchet cannot see). A tripwire, not a boundary: by-id lookups of the shared
 * tables are covered by the agency guards and their tests (person-billing-isolation.test.ts).
 */
const PERSON_ROW_TEXT =
  /payer_account_id|payerAccountId|person_receipt_counters|organization_id"?\s+is\s+null/i;

/**
 * The private person section of the recording module: the payer column may be named only below
 * this line of invoice-ledger.ts (its agency code above it may not).
 */
/**
 * Shared modules where a person's billing may be named only below a marker: everything above it is
 * agency code and must not name the payer column. Fixed, like the lists above.
 */
const PERSON_SECTIONS: Readonly<Record<string, string>> = {
  'invoice-ledger': "// --- A person's own invoice (ADR 0025, T3b)",
  // T6: person refunds reuse the agency refund rules from below this marker.
  refunds: "// --- A person's refund (ADR 0025, T6)",
};

/** Service and web files outside PAYER_COLUMN_MODULES that match PERSON_ROW_TEXT. Tests left out. */
function payerColumnUsers(): string[] {
  const sections = new Map(
    Object.entries(PERSON_SECTIONS).map(([m, marker]) => [path.join(srcDir, `${m}.ts`), marker]),
  );
  const allowed = new Set(
    PAYER_COLUMN_MODULES.filter((m) => !Object.hasOwn(PERSON_SECTIONS, m)).map((m) =>
      path.join(srcDir, `${m}.ts`),
    ),
  );
  const checkedText = (file: string): string => {
    const text = readFileSync(file, 'utf8');
    const marker = sections.get(file);
    if (marker === undefined) return text;
    const at = text.indexOf(marker);
    if (at < 0) throw new Error(`${path.basename(file)} has lost its person section marker`);
    return text.slice(0, at);
  };
  return [...sourceFilesUnder(srcDir), ...sourceFilesUnder(webSrcDir)]
    .map(real)
    .filter((file) => !isTestFile(file) && !/\.test\.tsx$/.test(file) && !allowed.has(file))
    .filter((file) => PERSON_ROW_TEXT.test(checkedText(file)))
    .map((file) => path.relative(repoDir, file).replace(/\\/g, '/'))
    .sort();
}

function readBaseline(): string[] {
  const parsed: unknown = JSON.parse(readFileSync(baselineFile, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error('enforcement-baseline.json must be a JSON array of "module#function" strings');
  }
  return parsed;
}

describe('access gate enforcement ratchet', () => {
  it('every exported function touching an applicant-owned table takes a gate type or is baselined', () => {
    const analysis = analyse();
    const baseline = readBaseline();

    // Guard the analysis itself so a parsing regression cannot pass silently.
    for (const table of ['applicants', 'documents', 'missions', 'grants', 'documentVersions']) {
      expect(analysis.ownedTableNames.has(table), `expected ${table} to be applicant-owned`).toBe(
        true,
      );
    }
    expect(analysis.ownedTableNames.has('accounts')).toBe(false);
    // S20: the ticked documents of an AI connection are applicant-owned through document_id.
    expect(analysis.ownedTableNames.has('aiConnectionDocuments')).toBe(true);
    expect(analysis.exportedFunctionIds.has('access/require-access#requireAccess')).toBe(true);
    expect(analysis.violations.has('access/require-access#requireAccess')).toBe(false);

    expect(
      analysis.systemScopeUsers,
      'only the job routes in apps/web/src/app/api/jobs may use systemPrincipal',
    ).toEqual([]);
    expect(
      analysis.selfScopeUsers,
      'only withSession (apps/web/src/lib/session.ts) may use selfPrincipal',
    ).toEqual([]);
    for (const id of SELF_SAFE_CALLS) {
      expect(analysis.exportedFunctionIds.has(id), `${id} is listed but no longer exists`).toBe(
        true,
      );
    }

    const duplicates = baseline.filter((entry, i) => baseline.indexOf(entry) !== i);
    expect(duplicates, 'duplicate baseline entries').toEqual([]);
    expect(baseline, 'keep enforcement-baseline.json sorted').toEqual([...baseline].sort());

    const baselineSet = new Set(baseline);
    const newViolations = [...analysis.violations].filter((id) => !baselineSet.has(id)).sort();
    expect(
      newViolations,
      `These exported functions touch applicant-owned tables without a gate parameter (AuthorizedApplicant, SystemScope or StaffScope). Take one via requireAccess instead of adding them to the baseline:\n${JSON.stringify(newViolations, null, 2)}`,
    ).toEqual([]);

    const stale = baseline.filter((id) => !analysis.violations.has(id));
    const staleDetail = stale.map((id) =>
      analysis.exportedFunctionIds.has(id)
        ? `${id} (now uses the gate)`
        : `${id} (no longer exists)`,
    );
    expect(
      stale,
      `Remove these entries from packages/services/src/access/enforcement-baseline.json (the baseline only shrinks):\n${staleDetail.join('\n')}`,
    ).toEqual([]);
  }, 180_000);
});

describe('person billing ratchet (ADR 0025)', () => {
  it('every exported function touching a person billing table takes SelfScope, StaffScope or SystemScope', () => {
    const { program } = programOnce();
    const checker = program.getTypeChecker();
    const tables = allTables(sourceFileAt(program, real(personTablesFile)));
    // Guard the analysis itself: the six declarations are found.
    expect([...tables.names].sort()).toEqual([
      'personInvoices',
      'personPaymentAttempts',
      'personPaymentReceipts',
      'personReceiptCounters',
      'personRefundRequests',
      'personSubscriptions',
    ]);
    const { violations, exportedFunctionIds } = ratchet(
      program,
      checker,
      tables,
      gateDeclarations(program, checker, PERSON_GATE_TYPES),
      { trusted: new Set(Object.keys(PERSON_TRUSTED)) },
    );
    for (const id of Object.keys(PERSON_TRUSTED)) {
      expect(exportedFunctionIds.has(id), `${id} is trusted but no longer exists`).toBe(true);
    }
    expect(
      [...violations].filter((id) => !Object.hasOwn(PERSON_EXCEPTIONS, id)).sort(),
      'These exported functions touch person billing tables without a SelfScope, StaffScope or SystemScope parameter',
    ).toEqual([]);

    // The plain-SQL readers are confined to the allowed modules, and every exported function there
    // is either gated or a listed exception with its reason.
    expect(payerColumnUsers(), 'only the person billing modules may name payer_account_id').toEqual(
      [],
    );
    const personGates = gateDeclarations(program, checker, PERSON_GATE_TYPES);
    // The plain-SQL reader module is judged function by function (the others are seen by the
    // type-based ratchet above).
    for (const module of ['traveller-billing', 'person-renewals']) {
      const sf = sourceFileAt(program, real(path.join(srcDir, `${module}.ts`)));
      for (const [name, shape] of exportedFunctions(checker, sf)) {
        const id = `${module}#${name}`;
        const gated = !shape.opaque && complies(checker, shape.fns, personGates);
        expect(gated || Object.hasOwn(PERSON_EXCEPTIONS, id), `${id} needs a gate`).toBe(true);
      }
    }
    for (const id of Object.keys(PERSON_EXCEPTIONS)) {
      expect(exportedFunctionIds.has(id), `${id} is listed but no longer exists`).toBe(true);
    }
    // An exception that now takes a gate is removed from the list, as the baseline only shrinks.
    for (const [name, shape] of exportedFunctions(
      checker,
      sourceFileAt(program, real(path.join(srcDir, 'traveller-billing.ts'))),
    )) {
      const id = `traveller-billing#${name}`;
      if (!Object.hasOwn(PERSON_EXCEPTIONS, id)) continue;
      const gated = !shape.opaque && complies(checker, shape.fns, personGates);
      expect(gated, `${id} now takes a gate: remove it from PERSON_EXCEPTIONS`).toBe(false);
    }
  }, 180_000);
});

describe('functions taking a SelfScope (ADR 0025)', () => {
  it('check the scope first and take no other account id', () => {
    const { program } = programOnce();
    const checker = program.getTypeChecker();
    const selfDecls = gateDeclarations(program, checker, ['SelfScope']);
    const found: string[] = [];
    const problems: string[] = [];
    for (const sf of program.getSourceFiles()) {
      const fileName = real(sf.fileName);
      if (sf.isDeclarationFile || !fileName.startsWith(srcDir + path.sep) || isTestFile(fileName)) {
        continue;
      }
      if (fileName.startsWith(accessDir + path.sep)) continue;
      for (const [name, shape] of exportedFunctions(checker, sf)) {
        for (const fn of shape.fns) {
          const selfParams = fn.parameters.filter((p) =>
            isGateType(checker.getTypeAtLocation(p), selfDecls),
          );
          if (selfParams.length === 0) continue;
          const id = `${moduleId(fileName)}#${name}`;
          found.push(id);
          // A real call of selfScopeProblem on the scope parameter itself (not text in a comment).
          const selfNames = new Set(selfParams.map((p) => p.name.getText()));
          let checks = false;
          const visit = (node: ts.Node) => {
            if (
              ts.isCallExpression(node) &&
              ts.isIdentifier(node.expression) &&
              node.expression.text === 'selfScopeProblem' &&
              node.arguments.some((a) => ts.isIdentifier(a) && selfNames.has(a.text))
            ) {
              checks = true;
            }
            ts.forEachChild(node, visit);
          };
          if (fn.body) visit(fn.body);
          if (!checks) problems.push(`${id} does not call selfScopeProblem on its scope`);
          // No other parameter, or property of one (two levels deep), names a person: the scope
          // says whose rows.
          const PERSON_ID = /(account|payer|person|owner|user)_?id/i;
          const props = (type: ts.Type, prefix: string, depth: number): void => {
            for (const prop of type.getProperties()) {
              const label = `${prefix}.${prop.getName()}`;
              if (PERSON_ID.test(prop.getName())) problems.push(`${id} takes ${label}`);
              if (depth > 0) {
                const decl = prop.valueDeclaration ?? prop.declarations?.[0];
                if (decl) props(checker.getTypeOfSymbolAtLocation(prop, decl), label, depth - 1);
              }
            }
          };
          for (const p of fn.parameters) {
            if (selfParams.includes(p)) continue;
            if (PERSON_ID.test(p.name.getText())) problems.push(`${id} takes ${p.name.getText()}`);
            props(checker.getTypeAtLocation(p), p.name.getText(), 1);
          }
        }
      }
    }
    // Guard the scan itself: the person billing functions are found.
    expect(found).toEqual(
      expect.arrayContaining([
        'person-billing#startPersonCheckout',
        'payments#startPersonPayment',
        'person-billing#payablePersonInvoice',
      ]),
    );
    expect(problems).toEqual([]);
  }, 180_000);
});
