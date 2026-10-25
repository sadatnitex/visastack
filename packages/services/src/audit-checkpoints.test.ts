import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  createAuditCheckpoint,
  eventsInCheckpointRange,
  getLatestAuditCheckpoint,
  listAuditCheckpoints,
  verifyCheckpointAgainstChain,
  verifyCheckpointSignature,
} from './audit-checkpoints';
import { type Db, schema as dbSchema } from './db';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

const SECRET = 'test-checkpoint-signing-secret';

describe('audit checkpoints — externally-signed anchors over the audit chain (SEC-04)', () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
  });

  it('refuses to checkpoint an empty chain', async () => {
    const result = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(result)).toBe(false);
  });

  it('checkpoints real audit events and the signature verifies against the recorded secret', async () => {
    await provisionAccount(db, { email: 'a@example.com' });
    await provisionAccount(db, { email: 'b@example.com' });

    const result = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.fromSeq).toBe(1);
    expect(verifyCheckpointSignature(result.value, SECRET)).toBe(true);
    expect(await verifyCheckpointAgainstChain(db, result.value)).toBe(true);
  });

  it('a signature computed with the wrong secret does not verify', async () => {
    await provisionAccount(db, { email: 'a@example.com' });
    const result = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(verifyCheckpointSignature(result.value, 'a-different-secret')).toBe(false);
  });

  it('a checkpoint whose recorded hash no longer matches the live chain fails chain verification (tamper detection)', async () => {
    await provisionAccount(db, { email: 'a@example.com' });
    const result = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    // Simulate a party with full DB DDL access editing the event this
    // checkpoint anchors. audit_events' append-only RULE (migration 0000)
    // makes a plain UPDATE a silent no-op (DO INSTEAD NOTHING), so a raw
    // UPDATE alone would not actually change the row (proven next test
    // down, which relies on that exact no-op for audit_checkpoints). The
    // whole point of a checkpoint is to detect the case where the RULE
    // itself was bypassed (e.g. a superuser dropping or disabling it), so
    // this test reproduces that: disable the RULE, write, restore it,
    // the same sequence that level of access actually requires.
    await db.execute(sql`ALTER TABLE audit_events DISABLE RULE audit_events_no_update`);
    await db.execute(
      sql`UPDATE audit_events SET hash = 'tampered-hash-0000000000000000000000000000000000000000000000000000000000' WHERE seq = ${result.value.toSeq}`,
    );
    await db.execute(sql`ALTER TABLE audit_events ENABLE RULE audit_events_no_update`);

    expect(await verifyCheckpointAgainstChain(db, result.value)).toBe(false);
    // The stored signature itself is still internally self-consistent
    // (nobody touched the checkpoint row), which is exactly why chain
    // verification, not just signature verification, is required.
    expect(verifyCheckpointSignature(result.value, SECRET)).toBe(true);
  });

  it('a second checkpoint after new events covers only the new range, not a re-covered overlap', async () => {
    await provisionAccount(db, { email: 'a@example.com' });
    const first = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;

    await provisionAccount(db, { email: 'b@example.com' });
    await provisionAccount(db, { email: 'c@example.com' });
    const second = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;

    expect(second.value.fromSeq).toBe(first.value.toSeq + 1);
    expect(second.value.toSeq).toBeGreaterThan(first.value.toSeq);
  });

  it('calling createAuditCheckpoint again with no new events is a no-op that returns the existing latest checkpoint', async () => {
    await provisionAccount(db, { email: 'a@example.com' });
    const first = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;

    const second = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.id).toBe(first.value.id);

    const all = await listAuditCheckpoints(db);
    expect(all).toHaveLength(1);
  });

  it('getLatestAuditCheckpoint and listAuditCheckpoints agree, newest first', async () => {
    await provisionAccount(db, { email: 'a@example.com' });
    await createAuditCheckpoint(db, SECRET, 'v1');
    await provisionAccount(db, { email: 'b@example.com' });
    const second = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;

    const latest = await getLatestAuditCheckpoint(db);
    expect(latest?.id).toBe(second.value.id);
    const all = await listAuditCheckpoints(db);
    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe(second.value.id);
  });

  it('eventsInCheckpointRange returns exactly the events the checkpoint covers, in order', async () => {
    await provisionAccount(db, { email: 'a@example.com' });
    await provisionAccount(db, { email: 'b@example.com' });
    const result = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const events = await eventsInCheckpointRange(db, result.value);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.seq >= result.value.fromSeq && e.seq <= result.value.toSeq)).toBe(
      true,
    );
    // Ordered oldest first.
    for (let i = 1; i < events.length; i++) {
      expect((events[i]?.seq ?? 0) > (events[i - 1]?.seq ?? 0)).toBe(true);
    }
  });

  it('the audit_checkpoints table itself is append-only at the database level, matching audit_events', async () => {
    await provisionAccount(db, { email: 'a@example.com' });
    const result = await createAuditCheckpoint(db, SECRET, 'v1');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    await db.execute(
      sql`UPDATE audit_checkpoints SET signature = 'forged' WHERE id = ${result.value.id}`,
    );
    const rows = await db
      .select()
      .from(dbSchema.auditCheckpoints)
      .where(eq(dbSchema.auditCheckpoints.id, result.value.id));
    // The RULE silences the UPDATE (DO INSTEAD NOTHING) rather than erroring — confirm it had no effect.
    expect(rows[0]?.signature).toBe(result.value.signature);

    await db.execute(sql`DELETE FROM audit_checkpoints WHERE id = ${result.value.id}`);
    const stillThere = await db
      .select()
      .from(dbSchema.auditCheckpoints)
      .where(eq(dbSchema.auditCheckpoints.id, result.value.id));
    expect(stillThere).toHaveLength(1);
  });
});
