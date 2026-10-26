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

function resolve(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) return checker.getAliasedSymbol(symbol);
  return symbol;
}

function gateDeclarations(program: ts.Program, checker: ts.TypeChecker): Set<ts.Node> {
  const decls = new Set<ts.Node>();
  const found = new Set<string>();
  for (const file of ['principal.ts', 'require-access.ts']) {
    const sf = sourceFileAt(program, path.join(accessDir, file));
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) throw new Error(`no module symbol for ${file}`);
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      if (!(GATE_TYPES as readonly string[]).includes(exported.name)) continue;
      for (const decl of resolve(checker, exported)?.declarations ?? []) decls.add(decl);
      found.add(exported.name);
    }
  }
  for (const name of GATE_TYPES) {
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

function analyse(): Analysis {
  const { program, configFileNames } = loadProgram();
  const checker = program.getTypeChecker();
  const tables = ownedTables(sourceFileAt(program, schemaFile));
  const gateDecls = gateDeclarations(program, checker);

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
      if (violations.has(entry.id) || entry.inAccess) continue;
      entry.scan.memo.clear();
      const touches = entry.shape.roots.some((root) => touchesOwnedTable(entry.scan, root));
      const gated = !entry.shape.opaque && complies(checker, entry.shape.fns, gateDecls);
      if (touches && !gated) {
        violations.add(entry.id);
        ungatedNames.add(entry.name);
        for (const decl of entry.decls) ungatedDecls.add(decl);
        changed = true;
      }
    }
  }

  return {
    violations,
    exportedFunctionIds,
    ownedTableNames: tables.names,
    systemScopeUsers: systemScopeUsers(configFileNames),
  };
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
    expect(analysis.exportedFunctionIds.has('access/require-access#requireAccess')).toBe(true);
    expect(analysis.violations.has('access/require-access#requireAccess')).toBe(false);

    expect(
      analysis.systemScopeUsers,
      'only the job routes in apps/web/src/app/api/jobs may use systemPrincipal',
    ).toEqual([]);

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
