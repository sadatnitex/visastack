import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { computeAuditHash, verifyAuditChain } from './audit';
import * as schema from './schema';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Spin up an isolated in-memory Postgres with the migrations applied. */
async function freshDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

/** Non-throwing "take the single row" helper (avoids non-null assertions). */
function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('expected at least one row');
  return row;
}

describe('schema — migrations & tenancy', () => {
  it('applies the migration and round-trips an account + applicant', async () => {
    const db = await freshDb();
    const account = one(
      await db.insert(schema.accounts).values({ email: 'a@example.com' }).returning(),
    );
    expect(account.email).toBe('a@example.com');

    const applicant = one(
      await db
        .insert(schema.applicants)
        .values({ ownerAccountId: account.id, displayName: 'Nazmus Sadat' })
        .returning(),
    );
    expect(applicant.relationship).toBe('SELF');
    expect(applicant.ownerAccountId).toBe(account.id);
  });

  it('enforces the applicant→account foreign key', async () => {
    const db = await freshDb();
    await expect(
      db
        .insert(schema.applicants)
        .values({
          ownerAccountId: '00000000-0000-0000-0000-000000000000',
          displayName: 'Orphan',
        })
        .returning(),
    ).rejects.toThrow();
  });

  it('enforces one membership per (account, organization)', async () => {
    const db = await freshDb();
    const account = one(
      await db.insert(schema.accounts).values({ email: 'staff@agency.com' }).returning(),
    );
    const org = one(
      await db.insert(schema.organizations).values({ name: 'Acme Travel' }).returning(),
    );
    expect(org.status).toBe('PENDING_VERIFICATION');

    await db
      .insert(schema.memberships)
      .values({ accountId: account.id, organizationId: org.id, role: 'CASE_MANAGER' });

    await expect(
      db
        .insert(schema.memberships)
        .values({ accountId: account.id, organizationId: org.id, role: 'REVIEWER' }),
    ).rejects.toThrow();
  });

  it('rejects an invalid enum value at the database level', async () => {
    const db = await freshDb();
    await expect(
      db.execute(sql`INSERT INTO organizations (name, status) VALUES ('Bad', 'NOT_A_STATUS')`),
    ).rejects.toThrow();
  });
});

describe('schema — audit trail is append-only and tamper-evident', () => {
  it('chains hashes and refuses UPDATE/DELETE', async () => {
    const db = await freshDb();

    const f1 = { eventType: 'AUTHZ_DECISION', result: 'DENIED', applicantId: null } as const;
    const h1 = computeAuditHash(f1, null);
    await db
      .insert(schema.auditEvents)
      .values({ eventType: f1.eventType, result: 'DENIED', hash: h1, prevHash: null });

    const f2 = { eventType: 'FACT_APPROVED', result: 'ALLOWED', applicantId: null } as const;
    const h2 = computeAuditHash(f2, h1);
    await db
      .insert(schema.auditEvents)
      .values({ eventType: f2.eventType, result: 'ALLOWED', hash: h2, prevHash: h1 });

    // Append-only rules make mutation a no-op rather than an error.
    await db.execute(sql`UPDATE audit_events SET reason = 'tampered'`);
    await db.execute(sql`DELETE FROM audit_events`);

    const rows = await db.select().from(schema.auditEvents);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reason === null)).toBe(true);

    const chain = [
      { fields: f1, prevHash: null, hash: h1 },
      { fields: f2, prevHash: h1, hash: h2 },
    ];
    expect(verifyAuditChain(chain)).toBe(true);
  });

  it('detects a broken chain', () => {
    const f1 = { eventType: 'A', result: 'ALLOWED', applicantId: null } as const;
    const f2 = { eventType: 'B', result: 'ALLOWED', applicantId: null } as const;
    const h1 = computeAuditHash(f1, null);
    // Wrong prevHash on the second entry breaks the chain.
    const tampered = [
      { fields: f1, prevHash: null, hash: h1 },
      {
        fields: f2,
        prevHash: 'not-the-real-prev',
        hash: computeAuditHash(f2, 'not-the-real-prev'),
      },
    ];
    expect(verifyAuditChain(tampered)).toBe(false);
  });
});
