import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { entitlementsSchemaPresent } from './plans-schema';

/**
 * S29 guard: before migration 0107 a plain `.select()`, a plain `.returning()` or a whole-table
 * selection on plans, online payments or ledger rows names columns that do not exist yet, and the
 * page or payment behind it fails. Every read of these three tables goes through the column lists
 * in plans-schema.ts instead. This test reads the package's own code and refuses any such call.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url));
const TABLES = ['plans', 'paymentAttempts', 'invoicePayments'] as const;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.test.ts') &&
      !name.includes('test-support') &&
      !name.endsWith('.d.ts')
    ) {
      out.push(path);
    }
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every name that stands for one of the three tables in this file: `schema.x` and local aliases. */
function tableNames(source: string): string[] {
  const names: string[] = TABLES.map((t) => `schema.${t}`);
  for (const table of TABLES) {
    const alias = new RegExp(`const (\\w+) = schema\\.${table};`, 'g');
    for (const match of source.matchAll(alias)) if (match[1]) names.push(match[1]);
  }
  return names;
}

function unsafeTableReads(source: string): string[] {
  const problems: string[] = [];
  for (const name of tableNames(source)) {
    const target = escapeRegExp(name);
    const plainSelect = new RegExp(`\\.select\\(\\)\\s*\\.from\\(\\s*${target}\\s*\\)`, 'g');
    for (const match of source.matchAll(plainSelect)) problems.push(match[0]);
    const plainReturning = new RegExp(
      `\\.(?:insert|update)\\(\\s*${target}\\s*\\)[^;]*?\\.returning\\(\\)`,
      'g',
    );
    for (const match of source.matchAll(plainReturning)) problems.push(match[0].slice(0, 80));
    // A whole table inside a selection (`{ plan: schema.plans }` or `{ entry: p }`).
    const wholeTable = new RegExp(`\\w+\\s*:\\s*${target}\\s*[,}]`, 'g');
    for (const match of source.matchAll(wholeTable)) problems.push(match[0]);
  }
  return problems;
}

describe('reads of plans, online payments and ledger rows (S29)', () => {
  it('never name every column of these tables directly', () => {
    const found: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith('plans-schema.ts')) continue;
      for (const problem of unsafeTableReads(readFileSync(file, 'utf8'))) {
        found.push(`${file.slice(SRC.length)}: ${problem.replace(/\s+/g, ' ')}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('recognises each unsafe shape (so it can fail)', () => {
    expect(unsafeTableReads('db.select().from(schema.plans)')).toHaveLength(1);
    expect(
      unsafeTableReads('const a = schema.paymentAttempts;\n tx.select()\n .from(a).where(x)'),
    ).toHaveLength(1);
    expect(
      unsafeTableReads('tx.update(schema.invoicePayments).set({ a: 1 }).where(x).returning();'),
    ).toHaveLength(1);
    expect(unsafeTableReads('db.select({ plan: schema.plans }).from(x)')).toHaveLength(1);
    expect(
      unsafeTableReads('const p = schema.invoicePayments;\n db.select({ entry: p, n: 1 }).from(p)'),
    ).toHaveLength(1);
    expect(unsafeTableReads('db.select(planColumns()).from(schema.plans)')).toEqual([]);
    expect(unsafeTableReads('tx.update(schema.plans).set({}).returning(planColumns());')).toEqual(
      [],
    );
  });
});

describe('the entitlement resolver stays inside the services package (S29 round 2)', () => {
  it('is not exported from the package index, since it takes no scope proof', () => {
    const index = readFileSync(join(SRC, 'index.ts'), 'utf8');
    const exportedNames = [...index.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/entitlements'/g)]
      .flatMap((m) => (m[1] ?? '').split(','))
      .map((n) => n.trim().replace(/^type\s+/, ''));
    expect(exportedNames).not.toContain('resolveEntitlements');
    expect(exportedNames.length).toBeGreaterThan(0);
  });
});

describe('the migration 0107 probe is remembered per database (S29 round 2)', () => {
  /** A stand-in handle that answers the probe with `present` and counts how often it was asked. */
  function handle(connectionString: string | null, present: boolean) {
    const calls = { n: 0 };
    const db = {
      ...(connectionString === null ? {} : { $client: { options: { connectionString } } }),
      select: () => ({
        from: async () => {
          calls.n++;
          return [{ present }];
        },
      }),
    } as unknown as Db;
    return { db, calls };
  }

  it('keeps a yes for every handle on the same database, never a no', async () => {
    const url = `postgres://probe-${crypto.randomUUID()}`;
    const no = handle(url, false);
    expect(await entitlementsSchemaPresent(no.db)).toBe(false);
    expect(await entitlementsSchemaPresent(no.db)).toBe(false);
    expect(no.calls.n).toBe(2);
    const yes = handle(url, true);
    expect(await entitlementsSchemaPresent(yes.db)).toBe(true);
    // A new handle (a new pool, a new request) on the same database is not asked again.
    const later = handle(url, false);
    expect(await entitlementsSchemaPresent(later.db)).toBe(true);
    expect(later.calls.n).toBe(0);
    // Another database is asked for itself.
    const other = handle(`postgres://other-${crypto.randomUUID()}`, false);
    expect(await entitlementsSchemaPresent(other.db)).toBe(false);
  });

  it('remembers per handle when the connection string cannot be read', async () => {
    const yes = handle(null, true);
    expect(await entitlementsSchemaPresent(yes.db)).toBe(true);
    expect(await entitlementsSchemaPresent(yes.db)).toBe(true);
    expect(yes.calls.n).toBe(1);
    const fresh = handle(null, false);
    expect(await entitlementsSchemaPresent(fresh.db)).toBe(false);
  });
});
