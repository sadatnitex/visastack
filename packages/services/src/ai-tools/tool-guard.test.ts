import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  AI_READ_TOOL_NAMES,
  AI_SUGGESTION_TOOL_NAMES,
  AI_TOOL_NAMES,
} from '../ai-connection-scopes';
import { AI_TOOLS } from './index';
import { READ_ONLY_ANNOTATIONS, SUGGESTION_ANNOTATIONS } from './result';

/**
 * Guard (S21, ADR 0021 extension): no AI tool can delete, submit, share, send, acknowledge,
 * change a permission, a grant or a case's state, pay, or touch an invoice. The registered tools
 * are listed here by name with their annotations; a new tool, a changed annotation, or a tool
 * whose name, description or inputs speak of one of those actions fails this test. The module
 * that writes for the suggestion tools is read as code: it may only add suggestions, runs,
 * drafts, reminders and their labels, and the only removal in it is the person's own draft
 * removal, outside the tools.
 */

const FORBIDDEN =
  /delet|remov|submit|share|send|acknowledg|permission|grant|status|state|pay|invoice|revoke/i;

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..');

/** The keys of a zod object schema, and the description of each. */
function inputs(tool: (typeof AI_TOOLS)[number]): { key: string; description: string }[] {
  const shape = tool.inputSchema.shape as Record<string, { description?: string }>;
  return Object.entries(shape).map(([key, field]) => ({
    key,
    description: field.description ?? '',
  }));
}

describe('the AI tools cannot do anything destructive or outward', () => {
  it('registers exactly the five read tools and the three suggestion tools, in that order', () => {
    expect(AI_TOOLS.map((t) => t.name)).toEqual([
      'prepare_context',
      'list_cases',
      'get_profile_section',
      'list_documents',
      'get_document_text',
      'suggest_profile_update',
      'save_draft',
      'add_reminder',
    ]);
    expect(AI_TOOLS.map((t) => t.name)).toEqual([...AI_TOOL_NAMES]);
    expect([...AI_READ_TOOL_NAMES, ...AI_SUGGESTION_TOOL_NAMES]).toEqual([...AI_TOOL_NAMES]);
  });

  it('gives every tool its annotations: read tools read only, suggestion tools add but never destroy', () => {
    const annotations = Object.fromEntries(AI_TOOLS.map((t) => [t.name, t.annotations]));
    expect(annotations).toEqual({
      prepare_context: READ_ONLY_ANNOTATIONS,
      list_cases: READ_ONLY_ANNOTATIONS,
      get_profile_section: READ_ONLY_ANNOTATIONS,
      list_documents: READ_ONLY_ANNOTATIONS,
      get_document_text: READ_ONLY_ANNOTATIONS,
      suggest_profile_update: SUGGESTION_ANNOTATIONS,
      save_draft: SUGGESTION_ANNOTATIONS,
      add_reminder: SUGGESTION_ANNOTATIONS,
    });
    expect(SUGGESTION_ANNOTATIONS).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    for (const tool of AI_TOOLS) {
      expect(tool.annotations.destructiveHint, tool.name).toBe(false);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
      // Only the three suggestion tools are allowed to write at all.
      expect(tool.annotations.readOnlyHint, tool.name).toBe(
        !(AI_SUGGESTION_TOOL_NAMES as readonly string[]).includes(tool.name),
      );
      expect('kind' in tool && tool.kind === 'suggestion', tool.name).toBe(
        (AI_SUGGESTION_TOOL_NAMES as readonly string[]).includes(tool.name),
      );
    }
  });

  it('names no forbidden action in any tool name or input, nor in a suggestion tool’s title or words', () => {
    const problems: string[] = [];
    for (const tool of AI_TOOLS) {
      for (const [what, text] of [
        ['name', tool.name],
        ...inputs(tool).map(({ key }) => ['input', key] as const),
      ] as const) {
        if (FORBIDDEN.test(text)) problems.push(`${tool.name} ${what}: ${text}`);
      }
      // The read tools' own words may say what the person shared; a suggestion tool's may not.
      if ('kind' in tool && tool.kind === 'suggestion') {
        if (FORBIDDEN.test(tool.title)) problems.push(`${tool.name} title`);
        if (FORBIDDEN.test(tool.description)) problems.push(`${tool.name} description`);
        for (const { key, description } of inputs(tool)) {
          if (FORBIDDEN.test(description)) problems.push(`${tool.name} ${key} description`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('tells the app, in every suggestion tool, to act only on the person’s own request', () => {
    for (const tool of AI_TOOLS) {
      if (!('kind' in tool && tool.kind === 'suggestion')) continue;
      expect(tool.description, tool.name).toContain(
        'Use only when the person explicitly asks for this change.',
      );
    }
  });

  it('the word rule itself catches each forbidden action', () => {
    for (const word of [
      'delete_draft',
      'remove_reminder',
      'submit_case',
      'share_record',
      'send_email',
      'acknowledge',
      'change_permission',
      'grant_access',
      'set_status',
      'change_state',
      'pay_invoice',
      'revoke_access',
    ]) {
      expect(FORBIDDEN.test(word), word).toBe(true);
    }
  });
});

/** Every `.insert(x)`, `.update(x)` and `.delete(x)` call in a file, with the function it is in. */
function writes(file: string): { op: string; target: string; inFunction: string }[] {
  const text = readFileSync(path.join(srcDir, file), 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: { op: string; target: string; inFunction: string }[] = [];
  const visit = (node: ts.Node, inFunction: string) => {
    let name = inFunction;
    if (ts.isFunctionDeclaration(node) && node.name) name = node.name.text;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['insert', 'update', 'delete', 'execute'].includes(node.expression.name.text)
    ) {
      const arg = node.arguments[0];
      found.push({
        op: node.expression.name.text,
        target: arg ? arg.getText(sf) : '',
        inFunction: name,
      });
    }
    ts.forEachChild(node, (child) => visit(child, name));
  };
  visit(sf, '');
  return found;
}

describe('what the suggestion writer can touch', () => {
  it('only adds suggestions, runs, drafts, reminders and their labels; removes only the person’s own draft', () => {
    const allowedInserts = new Set([
      'schema.aiExtractionRuns',
      'schema.fieldProposals',
      'schema.aiDrafts',
      'schema.missionTasks',
      'schema.aiTaskOrigins',
    ]);
    const found = writes('ai-suggestions.ts');
    expect(found.filter((w) => w.op === 'insert').every((w) => allowedInserts.has(w.target))).toBe(
      true,
    );
    expect(found.filter((w) => w.op === 'update')).toEqual([]);
    expect(found.filter((w) => w.op === 'execute')).toEqual([]);
    expect(found.filter((w) => w.op === 'delete')).toEqual([
      { op: 'delete', target: 'schema.aiDrafts', inFunction: 'deleteAiDraft' },
    ]);
    // The draft removal is the person's own, never reachable from a tool.
    const gate = readFileSync(path.join(srcDir, 'access', 'with-ai-connection.ts'), 'utf8');
    expect(gate).not.toContain('deleteAiDraft');
    for (const tool of AI_TOOLS) expect(tool.run.toString()).not.toContain('deleteAiDraft');
    // The labels for reminders are only read.
    expect(writes('ai-task-origins.ts')).toEqual([]);
  });

  it('the rule itself sees a write it should refuse', () => {
    const probe = ts.createSourceFile(
      'probe.ts',
      'async function f(tx) { await tx.update(schema.facts).set({}); }',
      ts.ScriptTarget.Latest,
      true,
    );
    let seen = false;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'update'
      ) {
        seen = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(probe);
    expect(seen).toBe(true);
  });
});

/** Every call to a function named `name` inside `fn` (by text position), in source order. */
function callPositions(sf: ts.SourceFile, fn: ts.Node, names: readonly string[]) {
  const found: { name: string; pos: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (names.includes(name)) found.push({ name, pos: node.getStart(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return found.sort((a, b) => a.pos - b.pos);
}

function functionNamed(sf: ts.SourceFile, name: string): ts.FunctionDeclaration {
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!found) throw new Error(`no function ${name}`);
  return found;
}

/** Whether the calls in a write path take the limit rows before the audit chain. */
function lockOrderProblems(source: string): string[] {
  const sf = ts.createSourceFile('gate.ts', source, ts.ScriptTarget.Latest, true);
  const save = functionNamed(sf, 'save');
  const calls = callPositions(sf, save, ['checkRateLimits', 'appendAuditEvent', 'lockAuditChain']);
  const charge = calls.findIndex((call) => call.name === 'checkRateLimits');
  const problems: string[] = [];
  if (charge === -1) problems.push('save does not charge the limits');
  if (calls.slice(0, Math.max(charge, 0)).some((call) => call.name !== 'checkRateLimits')) {
    problems.push('the audit chain is touched before the limit rows');
  }
  const caps = functionNamed(sf, 'capsAt').getText(sf);
  if (caps.indexOf('ai_write.connection') > caps.indexOf('ai_write.account')) {
    problems.push('the account limit row is taken before the connection limit row');
  }
  return problems;
}

describe('one lock order for every AI write (S21 review item 5)', () => {
  it('limit rows (connection, then account), then the audit chain; the writer itself never touches the chain', () => {
    const gate = readFileSync(path.join(srcDir, 'access', 'with-ai-connection.ts'), 'utf8');
    expect(lockOrderProblems(gate)).toEqual([]);
    const writer = readFileSync(path.join(srcDir, 'ai-suggestions.ts'), 'utf8');
    const sf = ts.createSourceFile('ai-suggestions.ts', writer, ts.ScriptTarget.Latest, true);
    for (const name of ['recordProfileSuggestion', 'recordAiDraft', 'recordAiReminder']) {
      expect(
        callPositions(sf, functionNamed(sf, name), [
          'appendAuditEvent',
          'lockAuditChain',
          'checkRateLimit',
          'checkRateLimits',
        ]),
        name,
      ).toEqual([]);
    }
  });

  it('the rule itself sees an audit append before the charge', () => {
    const bad = `function capsAt() { return ['ai_write.connection', 'ai_write.account']; }
      async function save() { await appendAuditEvent(tx, {}); await checkRateLimits(tx, caps); }`;
    expect(lockOrderProblems(bad)).toEqual(['the audit chain is touched before the limit rows']);
  });
});

/**
 * Modules under src/ (any folder) that use `mission_tasks`, and whether they serve an agency. A
 * new one must be listed. Paths are relative to src/.
 */
const TASK_READERS: Readonly<Record<string, 'agency' | 'owner or system'>> = {
  'agency.ts': 'agency',
  'ai-suggestions.ts': 'owner or system',
  'attention.ts': 'owner or system',
  'case-retention.ts': 'owner or system',
  'deadline-clock.ts': 'owner or system',
  'export.ts': 'owner or system',
  // Names the account export's own tasks table (mission_tasks.csv); it reads nothing itself.
  'export-csv.ts': 'owner or system',
  'missions.ts': 'owner or system',
  'notification-sweep.ts': 'owner or system',
};

const TASK_TABLE = 'missionTasks';
const TASK_SQL_NAME = 'mission_tasks';
const READ_METHODS = new Set(['from', 'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin']);

/** Every non-test .ts file under `dir`, in every subfolder, relative to src/. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith('.ts') || /\.test(-support)?\.ts$|\.test-d\.ts$/.test(entry.name)) {
      return [];
    }
    return [path.relative(srcDir, full).split(path.sep).join('/')];
  });
}

function inTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false;
  }
  return false;
}

/**
 * How a file reaches the tasks table, found by identifier rather than by one exact text: the
 * table under any name (`schema.missionTasks`, `x['missionTasks']`, `db.query.missionTasks`, an
 * import `{ missionTasks as t }`, a destructuring `const { missionTasks: t } = schema`, or
 * `const t = schema.missionTasks`), and raw SQL naming `mission_tasks`. Type-only uses are not
 * uses. `reads` are the uses that read rows: the table given to `.from(...)` or a join, the
 * relational `db.query.missionTasks`, the table placed whole into a `sql` template, and raw SQL.
 */
function taskUses(fileName: string, source: string): { uses: number; reads: ts.Node[] } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const aliases = new Set<string>();
  // Pass 1: the local names the table goes by.
  const collect = (node: ts.Node) => {
    if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === TASK_TABLE) {
      aliases.add(node.name.text);
    }
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      (node.propertyName && ts.isIdentifier(node.propertyName)
        ? node.propertyName.text
        : node.name.text) === TASK_TABLE
    ) {
      aliases.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isTableName(node.initializer)
    ) {
      aliases.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  const isTableName = (node: ts.Node): boolean =>
    (ts.isPropertyAccessExpression(node) && node.name.text === TASK_TABLE) ||
    (ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === TASK_TABLE);
  collect(sf);
  const isTable = (node: ts.Node): boolean =>
    isTableName(node) ||
    (ts.isIdentifier(node) &&
      aliases.has(node.text) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
      !ts.isImportSpecifier(node.parent) &&
      !ts.isBindingElement(node.parent) &&
      !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node));
  let uses = 0;
  const reads: ts.Node[] = [];
  // Pass 2: every use, and which of them read rows.
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes(TASK_SQL_NAME)
    ) {
      uses += 1;
      reads.push(node);
    } else if (isTable(node) && !inTypePosition(node)) {
      uses += 1;
      const parent = node.parent;
      const relational =
        ts.isPropertyAccessExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'query';
      const fromOrJoin =
        ts.isCallExpression(parent) &&
        parent.arguments[0] === node &&
        ts.isPropertyAccessExpression(parent.expression) &&
        READ_METHODS.has(parent.expression.name.text);
      const wholeInSql = ts.isTemplateSpan(parent) && parent.expression === node;
      if (relational || fromOrJoin || wholeInSql) reads.push(node);
      // A column of the table (`t.id`) is a use, not a read on its own; do not count its parts.
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { uses, reads };
}

/** Whether `node` calls `agencyVisibleTasks(...)` anywhere inside it. */
function callsAgencyFilter(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'agencyVisibleTasks'
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * The reads of tasks in an agency-facing file that are not filtered by `agencyVisibleTasks`: a
 * read counts as filtered only when the whole statement it is part of calls the filter.
 * `agencyVisibleTasks` itself is the filter and is not checked. Writes (insert, update) are not
 * reads: in agency.ts each one follows a filtered read of the same task in the same transaction.
 */
function unfilteredTaskReads(source: string, fileName = 'agency.ts'): number {
  return taskUses(fileName, source).reads.filter((read) => {
    let statement: ts.Node = read;
    while (statement.parent && !ts.isStatement(statement)) statement = statement.parent;
    for (let current: ts.Node | undefined = read; current; current = current.parent) {
      if (ts.isFunctionDeclaration(current) && current.name?.text === 'agencyVisibleTasks') {
        return false;
      }
    }
    return !callsAgencyFilter(statement);
  }).length;
}

describe('agencies never read an AI reminder (S21 review cleanup, round 3)', () => {
  it('every module under src/ that uses tasks is known, and every agency read goes through agencyVisibleTasks', () => {
    const files = sourceFiles(srcDir);
    expect(files.some((file) => file.includes('/'))).toBe(true);
    const readers = files
      .filter((file) => taskUses(file, readFileSync(path.join(srcDir, file), 'utf8')).uses > 0)
      .sort();
    expect(readers).toEqual(Object.keys(TASK_READERS).sort());
    for (const [file, audience] of Object.entries(TASK_READERS)) {
      if (audience !== 'agency') continue;
      expect(unfilteredTaskReads(readFileSync(path.join(srcDir, file), 'utf8'), file), file).toBe(
        0,
      );
    }
  });

  it.each([
    [
      'the schema object',
      'async function f(db) { return db.select().from(schema.missionTasks).where(eq(a, b)); }',
    ],
    [
      'a renamed import',
      "import { missionTasks as t } from '@visastack/db/schema';\nasync function f(db) { return db.select().from(t); }",
    ],
    [
      'a destructuring',
      'const { missionTasks } = schema;\nasync function f(db) { return db.select().from(missionTasks); }',
    ],
    [
      'a renamed destructuring',
      'const { missionTasks: tasks } = s;\nasync function f(db) { return db.select().from(other).innerJoin(tasks, eq(a, b)); }',
    ],
    [
      'a local name',
      'const t = db2.missionTasks;\nasync function f(db) { return db.select().from(t); }',
    ],
    ['the relational query', 'async function f(db) { return db.query.missionTasks.findMany(); }'],
    [
      'an element access',
      "async function f(db) { return db.select().from(schema['missionTasks']); }",
    ],
    ['raw SQL', 'async function f(db) { return db.execute(sql`select * from mission_tasks`); }'],
  ])('the rule itself sees an unfiltered agency read through %s', (_, source) => {
    expect(unfilteredTaskReads(source)).toBe(1);
    expect(taskUses('x.ts', source).uses).toBeGreaterThan(0);
  });

  it('the rule accepts a filtered read and ignores types and columns alone', () => {
    expect(
      unfilteredTaskReads(
        'async function f(db) { return db.select().from(schema.missionTasks).where(and(eq(a, b), await agencyVisibleTasks(db))); }',
      ),
    ).toBe(0);
    expect(taskUses('x.ts', 'type T = typeof schema.missionTasks.$inferSelect;').uses).toBe(0);
    expect(unfilteredTaskReads('const x = eq(schema.missionTasks.id, y);')).toBe(0);
  });
});
