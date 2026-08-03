import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
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

describe('schema — missions & grants', () => {
  async function seedApplicant(db: Awaited<ReturnType<typeof freshDb>>) {
    const account = one(
      await db
        .insert(schema.accounts)
        .values({ email: `${randomUUID()}@x.com` })
        .returning(),
    );
    return one(
      await db
        .insert(schema.applicants)
        .values({ ownerAccountId: account.id, displayName: 'Owner' })
        .returning(),
    );
  }

  it('creates a mission with the default DRAFT state', async () => {
    const db = await freshDb();
    const applicant = await seedApplicant(db);
    const mission = one(
      await db
        .insert(schema.missions)
        .values({ applicantId: applicant.id, title: 'UK Tourist Visa' })
        .returning(),
    );
    expect(mission.state).toBe('DRAFT');
  });

  it('stores a grant with an actions array and a recipient', async () => {
    const db = await freshDb();
    const applicant = await seedApplicant(db);
    const org = one(
      await db.insert(schema.organizations).values({ name: 'Acme Travel' }).returning(),
    );
    const grant = one(
      await db
        .insert(schema.grants)
        .values({
          applicantId: applicant.id,
          recipientOrganizationId: org.id,
          actions: ['PREVIEW', 'DOWNLOAD_REDACTED'],
          purpose: 'visa_application',
        })
        .returning(),
    );
    expect(grant.status).toBe('PENDING_ACCEPTANCE');
    expect(grant.actions).toEqual(['PREVIEW', 'DOWNLOAD_REDACTED']);
  });

  it('rejects a grant with no recipient (check constraint)', async () => {
    const db = await freshDb();
    const applicant = await seedApplicant(db);
    await expect(
      db
        .insert(schema.grants)
        .values({ applicantId: applicant.id, actions: ['PREVIEW'], purpose: 'x' }),
    ).rejects.toThrow();
  });
});

describe('schema — document vault', () => {
  async function seedApplicant(db: Awaited<ReturnType<typeof freshDb>>) {
    const account = one(
      await db
        .insert(schema.accounts)
        .values({ email: `${randomUUID()}@x.com` })
        .returning(),
    );
    return one(
      await db
        .insert(schema.applicants)
        .values({ ownerAccountId: account.id, displayName: 'Owner' })
        .returning(),
    );
  }

  it('creates a document + version with safe defaults', async () => {
    const db = await freshDb();
    const applicant = await seedApplicant(db);
    const storageObject = one(
      await db
        .insert(schema.storageObjects)
        .values({ bucket: 'QUARANTINE', objectKey: randomUUID() })
        .returning(),
    );
    const document = one(
      await db
        .insert(schema.documents)
        .values({ applicantId: applicant.id, originalName: 'passport.pdf' })
        .returning(),
    );
    const version = one(
      await db
        .insert(schema.documentVersions)
        .values({ documentId: document.id, storageObjectId: storageObject.id })
        .returning(),
    );
    expect(version.versionNumber).toBe(1);
    expect(version.processingStatus).toBe('UPLOADING');
    expect(version.safetyStatus).toBe('PENDING');
  });

  it('enforces unique (document, version number)', async () => {
    const db = await freshDb();
    const applicant = await seedApplicant(db);
    const storageObject = one(
      await db
        .insert(schema.storageObjects)
        .values({ bucket: 'CLEAN', objectKey: randomUUID() })
        .returning(),
    );
    const document = one(
      await db
        .insert(schema.documents)
        .values({ applicantId: applicant.id, originalName: 'a.pdf' })
        .returning(),
    );
    await db
      .insert(schema.documentVersions)
      .values({ documentId: document.id, storageObjectId: storageObject.id, versionNumber: 1 });
    await expect(
      db
        .insert(schema.documentVersions)
        .values({ documentId: document.id, storageObjectId: storageObject.id, versionNumber: 1 }),
    ).rejects.toThrow();
  });

  it('rejects an invalid storage bucket at the database level', async () => {
    const db = await freshDb();
    await expect(
      db.execute(sql`INSERT INTO storage_objects (bucket, object_key) VALUES ('PUBLIC', 'k')`),
    ).rejects.toThrow();
  });
});

describe('schema — Master Profile fact model', () => {
  async function seedApplicant(db: Awaited<ReturnType<typeof freshDb>>) {
    const account = one(
      await db
        .insert(schema.accounts)
        .values({ email: `${randomUUID()}@x.com` })
        .returning(),
    );
    return one(
      await db
        .insert(schema.applicants)
        .values({ ownerAccountId: account.id, displayName: 'Owner' })
        .returning(),
    );
  }

  it('points a fact at its immutable current version (approval)', async () => {
    const db = await freshDb();
    const applicant = await seedApplicant(db);
    const fieldDef = one(
      await db
        .insert(schema.fieldDefinitions)
        .values({ key: 'passport.number', dataType: 'string' })
        .returning(),
    );
    const fact = one(
      await db
        .insert(schema.facts)
        .values({ applicantId: applicant.id, fieldDefinitionId: fieldDef.id })
        .returning(),
    );
    const version = one(
      await db
        .insert(schema.factVersions)
        .values({ factId: fact.id, value: 'A1234567', status: 'APPLICANT_CONFIRMED' })
        .returning(),
    );
    // Approval sets the current-version pointer.
    const [updated] = await db
      .update(schema.facts)
      .set({ currentVersionId: version.id })
      .where(eq(schema.facts.id, fact.id))
      .returning();
    expect(updated?.currentVersionId).toBe(version.id);
    expect(version.status).toBe('APPLICANT_CONFIRMED');
  });

  it('defaults a fact version to DECLARED', async () => {
    const db = await freshDb();
    const applicant = await seedApplicant(db);
    const fieldDef = one(
      await db
        .insert(schema.fieldDefinitions)
        .values({ key: 'name.full', dataType: 'string' })
        .returning(),
    );
    const fact = one(
      await db
        .insert(schema.facts)
        .values({ applicantId: applicant.id, fieldDefinitionId: fieldDef.id })
        .returning(),
    );
    const version = one(
      await db.insert(schema.factVersions).values({ factId: fact.id, value: 'x' }).returning(),
    );
    expect(version.status).toBe('DECLARED');
  });

  it('enforces unique evidence links (fact version ↔ document version)', async () => {
    const db = await freshDb();
    const applicant = await seedApplicant(db);
    const fieldDef = one(
      await db
        .insert(schema.fieldDefinitions)
        .values({ key: 'passport.expiry', dataType: 'date' })
        .returning(),
    );
    const fact = one(
      await db
        .insert(schema.facts)
        .values({ applicantId: applicant.id, fieldDefinitionId: fieldDef.id })
        .returning(),
    );
    const version = one(
      await db.insert(schema.factVersions).values({ factId: fact.id }).returning(),
    );
    const storageObject = one(
      await db
        .insert(schema.storageObjects)
        .values({ bucket: 'CLEAN', objectKey: randomUUID() })
        .returning(),
    );
    const document = one(
      await db
        .insert(schema.documents)
        .values({ applicantId: applicant.id, originalName: 'p.pdf' })
        .returning(),
    );
    const docVersion = one(
      await db
        .insert(schema.documentVersions)
        .values({ documentId: document.id, storageObjectId: storageObject.id })
        .returning(),
    );
    await db
      .insert(schema.evidenceLinks)
      .values({ factVersionId: version.id, documentVersionId: docVersion.id });
    await expect(
      db
        .insert(schema.evidenceLinks)
        .values({ factVersionId: version.id, documentVersionId: docVersion.id }),
    ).rejects.toThrow();
  });
});

describe('migration 0024 on an already-populated database (Codex review, PR #65)', () => {
  it('deduplicates pre-existing duplicate active platform-role grants before enforcing the new unique index, instead of aborting the migration', async () => {
    // Simulate an "upgraded" database: apply every migration EXCEPT 0024
    // (the one adding `platform_roles_active_unique_idx`), insert data the
    // pre-fix `grantPlatformRole` could actually produce — migration 0019
    // had no such constraint, and the previous implementation never
    // checked for an existing active grant before inserting — then apply
    // 0024 and confirm it cleans up the duplicate instead of aborting
    // deployment with a unique-violation error.
    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    const priorEntries = journal.entries.filter(
      (e: { tag: string }) => e.tag !== '0024_strong_mother_askani',
    );
    const priorFolder = mkdtempSync(join(tmpdir(), 'visastack-migration-test-'));
    mkdirSync(join(priorFolder, 'meta'), { recursive: true });
    writeFileSync(
      join(priorFolder, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: priorEntries }),
    );
    for (const entry of priorEntries as { tag: string }[]) {
      copyFileSync(
        join(migrationsFolder, `${entry.tag}.sql`),
        join(priorFolder, `${entry.tag}.sql`),
      );
    }

    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: priorFolder });

    const account = one(
      await db.insert(schema.accounts).values({ email: 'dup-owner@example.com' }).returning(),
    );
    const [first, second] = await db
      .insert(schema.platformRoles)
      .values([
        {
          accountId: account.id,
          role: 'PLATFORM_OWNER',
          reason: 'first grant (pre-fix duplicate)',
          assignedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          accountId: account.id,
          role: 'PLATFORM_OWNER',
          reason: 'second grant (pre-fix duplicate)',
          assignedAt: new Date('2026-01-02T00:00:00Z'),
        },
      ])
      .returning();

    // Applying the rest of the migrations (including 0024) against this
    // already-duplicated state must not throw — the exact failure mode
    // Codex flagged (`CREATE UNIQUE INDEX` aborting on pre-existing
    // violations, blocking deployment).
    await migrate(db, { migrationsFolder });

    const rows = await db
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.accountId, account.id));
    const active = rows.filter((r) => r.revokedAt === null);
    const revoked = rows.filter((r) => r.revokedAt !== null);
    // Exactly one survivor stays active — the earliest grant — and the
    // duplicate is properly revoked (never deleted), preserving history.
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(first?.id);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]?.id).toBe(second?.id);
    expect(revoked[0]?.revokedReason).toContain('deduplicated');

    // The constraint now genuinely protects against a fresh duplicate.
    await expect(
      db.insert(schema.platformRoles).values({
        accountId: account.id,
        role: 'PLATFORM_OWNER',
        reason: 'a fresh duplicate after the fix — must be rejected',
      }),
    ).rejects.toThrow();
  });
});
