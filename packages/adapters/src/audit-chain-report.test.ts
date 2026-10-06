import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { provisionAccount } from '@visastack/services';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { runAuditChainVerification } from './audit-chain-report';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

type TestDb = Awaited<ReturnType<typeof freshDb>>;

async function writeEvents(db: TestDb, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const made = await provisionAccount(db as never, { email: `chain-${i}@example.com` });
    if (!isOk(made)) throw new Error('provision failed');
  }
}

// The database refuses edits and deletes through rules; these tests drop the rules to stand in for
// someone with privileged access to the data, which is the case the tool exists to catch.
describe('verify:audit-chain exit codes (restore and incident tool)', () => {
  it('exits 0 and says the chain is intact when nothing was touched', async () => {
    const db = await freshDb();
    await writeEvents(db, 3);
    const lines: string[] = [];
    const code = await runAuditChainVerification(db as never, Number.MAX_SAFE_INTEGER, (l) =>
      lines.push(l),
    );
    expect(code).toBe(0);
    expect(lines.at(-1)).toBe('audit chain intact');
    expect(lines[0]).toMatch(/^checked [1-9]\d* audit event/);
  }, 60_000);

  it('exits 1 when an event was edited after it was written', async () => {
    const db = await freshDb();
    await writeEvents(db, 3);
    await db.execute(sql`drop rule audit_events_no_update on audit_events`);
    await db.execute(
      sql`update audit_events set event_type = 'TAMPERED' where seq = (select min(seq) from audit_events)`,
    );
    const lines: string[] = [];
    const code = await runAuditChainVerification(db as never, Number.MAX_SAFE_INTEGER, (l) =>
      lines.push(l),
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/do not recompute/);
  }, 60_000);

  it('exits 1 and names the event when one is removed from the middle', async () => {
    const db = await freshDb();
    await writeEvents(db, 4);
    await db.execute(sql`drop rule audit_events_no_delete on audit_events`);
    await db.execute(
      sql`delete from audit_events where seq = (select seq from audit_events order by seq offset 1 limit 1)`,
    );
    const lines: string[] = [];
    const code = await runAuditChainVerification(db as never, Number.MAX_SAFE_INTEGER, (l) =>
      lines.push(l),
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/BROKEN: event \d+ does not link/);
  }, 60_000);
});
