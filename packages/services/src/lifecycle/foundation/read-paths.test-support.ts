import ts from 'typescript';

/*
 * The read-path analyser behind read-paths.test.ts (PROGRAMME section 3.3). Syntax only, so it
 * also runs over small fixture sources in the test: a comment or a string can never count as a
 * read or as compliance, because only syntax nodes are looked at.
 *
 * - A read of a table is the table passed to `.from(...)` or to a join (`innerJoin`, `leftJoin`,
 *   `rightJoin`, `fullJoin`), or the relational form `.query.<table>.findMany/findFirst(...)`.
 *   The table is `schema.<name>`, a name imported from the schema, or a module-level alias of
 *   either (`const docs = schema.documents`).
 * - Reads are counted per exported function, including the module's own private functions it
 *   calls (followed by name, at any depth).
 * - A document read complies when the function (or a private function it calls) names
 *   `presentDocumentCondition` or `everydayDocumentCondition` imported from the foundation.
 * - For applicants only list reads count: a read whose own `.where(...)` holds an `eq` on
 *   `applicants.id` reads one known record and is exempt by rule (a join's ON clause does not
 *   count as that equality).
 */

export type ReadTable = 'documents' | 'applicants';

export const READ_TABLES: readonly ReadTable[] = ['documents', 'applicants'];

const CONDITIONS: Readonly<Record<ReadTable, readonly string[]>> = {
  documents: ['presentDocumentCondition', 'everydayDocumentCondition'],
  applicants: ['presentApplicantCondition', 'everydayApplicantCondition'],
};

const JOINS = new Set(['from', 'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin', 'crossJoin']);

export interface ReadSite {
  /** `module#function`, the module relative to packages/services/src without `.ts`. */
  readonly id: string;
  readonly table: ReadTable;
  readonly complies: boolean;
}

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function hasExport(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

interface ModuleNames {
  /** Local names standing for each table. */
  readonly tables: Map<string, ReadTable>;
  /** Local names of the foundation conditions, mapped to the condition's own name. */
  readonly conditions: Map<string, string>;
  /** Private (non-exported) functions of the module by name. */
  readonly helpers: Map<string, FunctionLike>;
}

function tableOfAccess(node: ts.Expression): ReadTable | undefined {
  const target = unwrap(node);
  if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
    if (target.expression.text === 'schema') {
      const name = target.name.text;
      return (READ_TABLES as readonly string[]).includes(name) ? (name as ReadTable) : undefined;
    }
  }
  if (
    ts.isElementAccessExpression(target) &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === 'schema' &&
    ts.isStringLiteralLike(target.argumentExpression)
  ) {
    const name = target.argumentExpression.text;
    return (READ_TABLES as readonly string[]).includes(name) ? (name as ReadTable) : undefined;
  }
  return undefined;
}

function moduleNames(sf: ts.SourceFile): ModuleNames {
  const tables = new Map<string, ReadTable>();
  const conditions = new Map<string, string>();
  const helpers = new Map<string, FunctionLike>();
  const allConditions = new Set(Object.values(CONDITIONS).flat());
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const from = statement.moduleSpecifier.text;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (/(^|\/)schema$|^@visastack\/db(\/schema)?$/.test(from)) {
          if ((READ_TABLES as readonly string[]).includes(imported)) {
            tables.set(element.name.text, imported as ReadTable);
          }
        }
        if (
          /lifecycle\/foundation(\/index|\/conditions)?$|^\.\/conditions$|^@visastack\/services$/.test(
            from,
          )
        ) {
          if (allConditions.has(imported)) conditions.set(element.name.text, imported);
        }
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isObjectBindingPattern(decl.name) && decl.initializer) {
          const init = unwrap(decl.initializer);
          if (ts.isIdentifier(init) && init.text === 'schema') {
            for (const element of decl.name.elements) {
              const property = element.propertyName ?? element.name;
              if (
                ts.isIdentifier(property) &&
                ts.isIdentifier(element.name) &&
                (READ_TABLES as readonly string[]).includes(property.text)
              ) {
                tables.set(element.name.text, property.text as ReadTable);
              }
            }
          }
          continue;
        }
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = unwrap(decl.initializer);
        const table = tableOfAccess(init);
        if (table) tables.set(decl.name.text, table);
        if (!hasExport(statement) && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          helpers.set(decl.name.text, init);
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && !hasExport(statement)) {
      helpers.set(statement.name.text, statement);
    }
  }
  return { tables, conditions, helpers };
}

function tableOf(
  node: ts.Expression,
  names: ModuleNames,
  locals: Map<string, ReadTable>,
): ReadTable | undefined {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) return locals.get(target.text) ?? names.tables.get(target.text);
  return tableOfAccess(target);
}

/** True when an `eq(...)` inside the `.where(...)` calls of this query chain names `applicants.id`. */
function whereHasApplicantIdEquality(
  query: ts.Expression,
  names: ModuleNames,
  locals: Map<string, ReadTable>,
): boolean {
  let found = false;
  const isApplicantId = (expr: ts.Expression): boolean => {
    const target = unwrap(expr);
    return (
      ts.isPropertyAccessExpression(target) &&
      target.name.text === 'id' &&
      tableOf(target.expression, names, locals) === 'applicants'
    );
  };
  const visitWhere = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'eq' &&
      node.arguments.some((arg) => isApplicantId(arg))
    ) {
      found = true;
    }
    ts.forEachChild(node, visitWhere);
  };
  const visitChain = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'where'
    ) {
      for (const arg of node.arguments) visitWhere(arg);
    }
    ts.forEachChild(node, visitChain);
  };
  visitChain(query);
  return found;
}

/** The outermost call of the method chain `node` belongs to (`db.select().from(x).where(...)`). */
function chainTop(node: ts.Node): ts.Expression {
  let current = node as ts.Expression;
  for (;;) {
    const parent = current.parent;
    if (
      parent &&
      (ts.isPropertyAccessExpression(parent) || ts.isCallExpression(parent)) &&
      (ts.isPropertyAccessExpression(parent)
        ? parent.expression === current
        : parent.expression === current)
    ) {
      current = parent;
      continue;
    }
    if (parent && ts.isAwaitExpression(parent)) return current;
    return current;
  }
}

interface Scan {
  readonly tables: Set<ReadTable>;
  readonly conditionNames: Set<string>;
}

function scanFunction(fn: FunctionLike, names: ModuleNames, seen: Set<FunctionLike>): Scan {
  const tables = new Set<ReadTable>();
  const conditionNames = new Set<string>();
  if (seen.has(fn)) return { tables, conditionNames };
  seen.add(fn);
  // Function-local aliases (`const documents = schema.documents`).
  const locals = new Map<string, ReadTable>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const table = tableOfAccess(unwrap(node.initializer));
      if (table) locals.set(node.name.text, table);
    }
    if (ts.isIdentifier(node)) {
      const condition = names.conditions.get(node.text);
      if (condition) conditionNames.add(condition);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && JOINS.has(callee.name.text)) {
        const first = node.arguments[0];
        const table = first ? tableOf(first, names, locals) : undefined;
        if (table === 'documents') tables.add('documents');
        if (table === 'applicants' && !whereHasApplicantIdEquality(chainTop(node), names, locals)) {
          tables.add('applicants');
        }
      }
      // Relational queries: db.query.documents.findMany(...)
      if (
        ts.isPropertyAccessExpression(callee) &&
        (callee.name.text === 'findMany' || callee.name.text === 'findFirst') &&
        ts.isPropertyAccessExpression(callee.expression) &&
        ts.isPropertyAccessExpression(callee.expression.expression) &&
        callee.expression.expression.name.text === 'query'
      ) {
        const name = callee.expression.name.text;
        if (name === 'documents') tables.add('documents');
        if (name === 'applicants') tables.add('applicants');
      }
      if (ts.isIdentifier(callee)) {
        const helper = names.helpers.get(callee.text);
        if (helper) {
          const inner = scanFunction(helper, names, seen);
          for (const t of inner.tables) tables.add(t);
          for (const c of inner.conditionNames) conditionNames.add(c);
        }
      }
    }
    // A private function passed by name (`rows.map(helper)`, `t('x', helper)`).
    if (ts.isIdentifier(node) && !ts.isCallExpression(node.parent)) {
      const helper = names.helpers.get(node.text);
      if (helper && helper !== fn) {
        const inner = scanFunction(helper, names, seen);
        for (const t of inner.tables) tables.add(t);
        for (const c of inner.conditionNames) conditionNames.add(c);
      }
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return { tables, conditionNames };
}

function exportedFunctions(sf: ts.SourceFile): Array<[string, FunctionLike]> {
  const found: Array<[string, FunctionLike]> = [];
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && hasExport(statement)) {
      found.push([statement.name.text, statement]);
    }
    if (ts.isVariableStatement(statement) && hasExport(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const visitInit = (node: ts.Node): void => {
          if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
            found.push([(decl.name as ts.Identifier).text, node]);
            return;
          }
          ts.forEachChild(node, visitInit);
        };
        visitInit(decl.initializer);
      }
    }
  }
  return found;
}

/** Every read site of `documents` and `applicants` in one module, per exported function. */
export function readSitesOf(moduleId: string, source: string): ReadSite[] {
  const sf = ts.createSourceFile(`${moduleId}.ts`, source, ts.ScriptTarget.Latest, true);
  const names = moduleNames(sf);
  const sites = new Map<string, { tables: Set<ReadTable>; conditions: Set<string> }>();
  for (const [name, fn] of exportedFunctions(sf)) {
    const scan = scanFunction(fn, names, new Set());
    const key = `${moduleId}#${name}`;
    const entry = sites.get(key) ?? { tables: new Set<ReadTable>(), conditions: new Set<string>() };
    for (const t of scan.tables) entry.tables.add(t);
    for (const c of scan.conditionNames) entry.conditions.add(c);
    sites.set(key, entry);
  }
  const result: ReadSite[] = [];
  for (const [id, entry] of sites) {
    for (const table of READ_TABLES) {
      if (!entry.tables.has(table)) continue;
      result.push({
        id,
        table,
        complies: CONDITIONS[table].some((condition) => entry.conditions.has(condition)),
      });
    }
  }
  return result;
}

export interface ReadLists {
  /** Per owning lane: entries still to migrate. */
  readonly baselines: Readonly<Record<string, Readonly<Record<ReadTable, readonly string[]>>>>;
  /** Permanent exceptions, each with its reason. */
  readonly exempt: Readonly<Record<ReadTable, Readonly<Record<string, string>>>>;
}

export interface ReadProblems {
  /** A read that does not comply and is listed nowhere. */
  readonly unlisted: string[];
  /** A baseline entry that now complies, or no longer reads the table: remove it. */
  readonly stale: string[];
  /** An exempt entry that no longer reads the table. */
  readonly staleExempt: string[];
  /** An entry listed in more than one place. */
  readonly duplicated: string[];
}

/** Compare the read sites with the lists. Baselines only shrink. */
export function checkReadSites(sites: readonly ReadSite[], lists: ReadLists): ReadProblems {
  const unlisted: string[] = [];
  const stale: string[] = [];
  const staleExempt: string[] = [];
  const duplicated: string[] = [];
  for (const table of READ_TABLES) {
    const sitesForTable = new Map(
      sites.filter((site) => site.table === table).map((site) => [site.id, site] as const),
    );
    const listed = new Map<string, number>();
    for (const [lane, baseline] of Object.entries(lists.baselines)) {
      for (const id of baseline[table] ?? []) {
        listed.set(id, (listed.get(id) ?? 0) + 1);
        const site = sitesForTable.get(id);
        if (!site || site.complies) stale.push(`${lane}:${table}:${id}`);
      }
    }
    for (const id of Object.keys(lists.exempt[table] ?? {})) {
      listed.set(id, (listed.get(id) ?? 0) + 1);
      if (!sitesForTable.has(id)) staleExempt.push(`${table}:${id}`);
    }
    for (const [id, times] of listed) if (times > 1) duplicated.push(`${table}:${id}`);
    for (const site of sitesForTable.values()) {
      if (!site.complies && !listed.has(site.id)) unlisted.push(`${table}:${site.id}`);
    }
  }
  return {
    unlisted: unlisted.sort(),
    stale: stale.sort(),
    staleExempt: staleExempt.sort(),
    duplicated: duplicated.sort(),
  };
}
