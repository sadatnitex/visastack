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

/** Modules that use `mission_tasks`, and whether they serve an agency. A new one must be listed. */
const TASK_READERS: Readonly<Record<string, 'agency' | 'owner or system'>> = {
  'agency.ts': 'agency',
  'ai-suggestions.ts': 'owner or system',
  'attention.ts': 'owner or system',
  'case-retention.ts': 'owner or system',
  'deadline-clock.ts': 'owner or system',
  'export.ts': 'owner or system',
  'missions.ts': 'owner or system',
  'notification-sweep.ts': 'owner or system',
};

/** The `.from(schema.missionTasks)` reads in a file that are not filtered by `agencyVisibleTasks`. */
function unfilteredTaskReads(source: string): number {
  const sf = ts.createSourceFile('agency.ts', source, ts.ScriptTarget.Latest, true);
  let unfiltered = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'from' &&
      node.arguments[0]?.getText(sf) === 'schema.missionTasks'
    ) {
      // The whole query chain this read belongs to.
      let chain: ts.Node = node;
      while (
        ts.isPropertyAccessExpression(chain.parent) ||
        (ts.isCallExpression(chain.parent) && chain.parent.expression === chain)
      ) {
        chain = chain.parent;
      }
      if (!chain.getText(sf).includes('agencyVisibleTasks(')) unfiltered += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return unfiltered;
}

describe('agencies never read an AI reminder (S21 review cleanup)', () => {
  it('every module that reads tasks is known, and every agency read goes through agencyVisibleTasks', () => {
    const readers = readdirSync(srcDir)
      .filter((file) => file.endsWith('.ts') && !/\.test(-support)?\.ts$/.test(file))
      .filter((file) =>
        /schema\.missionTasks\b/.test(readFileSync(path.join(srcDir, file), 'utf8')),
      )
      .sort();
    expect(readers).toEqual(Object.keys(TASK_READERS).sort());
    const agency = readFileSync(path.join(srcDir, 'agency.ts'), 'utf8');
    expect(unfilteredTaskReads(agency)).toBe(0);
  });

  it('the rule itself sees an unfiltered agency read', () => {
    expect(
      unfilteredTaskReads(
        'async function f(db) { return db.select().from(schema.missionTasks).where(eq(a, b)); }',
      ),
    ).toBe(1);
  });
});
