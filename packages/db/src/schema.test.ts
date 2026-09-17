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

/**
 * Journal entries strictly BEFORE the named migration — i.e. the database
 * shape as it genuinely existed right before that migration was ever
 * written. Deliberately by position, not by excluding just the one matching
 * tag: filtering out only `e.tag !== targetTag` would incorrectly keep any
 * LATER migration that happens to exist in the current repo (as a fresh
 * migration added after this test was written did, once, break exactly
 * this way — a filter that excludes one tag says nothing about migrations
 * added afterward).
 */
function journalEntriesBefore(
  journal: { entries: readonly { tag: string }[] },
  targetTag: string,
): readonly { tag: string }[] {
  const idx = journal.entries.findIndex((e) => e.tag === targetTag);
  if (idx === -1) throw new Error(`migration ${targetTag} not found in journal`);
  return journal.entries.slice(0, idx);
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

  it('rejects a selected_evidence row with neither factId nor documentId set, and one with both (exactly-one check constraint)', async () => {
    const db = await freshDb();
    const applicant = await seedApplicant(db);
    const mission = one(
      await db
        .insert(schema.missions)
        .values({ applicantId: applicant.id, title: 'UK Tourist Visa' })
        .returning(),
    );
    const pack = one(
      await db.insert(schema.packs).values({ key: 'uk.tourist', name: 'UK Tourist' }).returning(),
    );
    const packVersion = one(
      await db.insert(schema.packVersions).values({ packId: pack.id, version: 1 }).returning(),
    );
    const requirement = one(
      await db
        .insert(schema.packRequirements)
        .values({
          packVersionId: packVersion.id,
          kind: 'FIELD',
          fieldKey: 'passport.number',
          citation: 'rule 1',
        })
        .returning(),
    );

    await expect(
      db.insert(schema.selectedEvidence).values({
        missionId: mission.id,
        packRequirementId: requirement.id,
      }),
    ).rejects.toThrow();

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
    const document = one(
      await db
        .insert(schema.documents)
        .values({ applicantId: applicant.id, originalName: 'p.pdf' })
        .returning(),
    );

    await expect(
      db.insert(schema.selectedEvidence).values({
        missionId: mission.id,
        packRequirementId: requirement.id,
        factId: fact.id,
        documentId: document.id,
      }),
    ).rejects.toThrow();

    // Exactly one of the two set is the only valid shape.
    const valid = one(
      await db
        .insert(schema.selectedEvidence)
        .values({ missionId: mission.id, packRequirementId: requirement.id, factId: fact.id })
        .returning(),
    );
    expect(valid.factId).toBe(fact.id);
    expect(valid.documentId).toBeNull();
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

  it("allows at most one non-VERIFIED erasure job per storage object (backstop for enqueueErasureJob's own check)", async () => {
    const db = await freshDb();
    const storageObject = one(
      await db
        .insert(schema.storageObjects)
        .values({ bucket: 'CLEAN', objectKey: randomUUID() })
        .returning(),
    );
    await db.insert(schema.erasureJobs).values({
      reason: 'ACCOUNT_DELETION',
      status: 'PENDING',
      bucket: 'CLEAN',
      objectKey: storageObject.objectKey,
      storageObjectId: storageObject.id,
    });
    // A second PENDING (or any non-VERIFIED) job for the SAME storage object
    // is rejected, bypassing the service layer entirely, proving the DB
    // constraint itself, not just enqueueErasureJob's own existence check.
    await expect(
      db.insert(schema.erasureJobs).values({
        reason: 'RETENTION_PURGE',
        status: 'FAILED',
        bucket: 'CLEAN',
        objectKey: storageObject.objectKey,
        storageObjectId: storageObject.id,
      }),
    ).rejects.toThrow();

    // Once VERIFIED, a fresh job for the same object is a different,
    // legitimate case (not a live duplicate) and is allowed.
    await db
      .update(schema.erasureJobs)
      .set({ status: 'VERIFIED' })
      .where(eq(schema.erasureJobs.storageObjectId, storageObject.id));
    await expect(
      db.insert(schema.erasureJobs).values({
        reason: 'RETENTION_PURGE',
        status: 'PENDING',
        bucket: 'CLEAN',
        objectKey: storageObject.objectKey,
        storageObjectId: storageObject.id,
      }),
    ).resolves.toBeDefined();
  });

  it('allows at most one PENDING account deletion request per account', async () => {
    const db = await freshDb();
    const account = one(
      await db
        .insert(schema.accounts)
        .values({ email: `${randomUUID()}@x.com` })
        .returning(),
    );
    await db.insert(schema.accountDeletionRequests).values({
      accountId: account.id,
      scheduledFor: new Date(),
    });
    // A second PENDING request for the SAME account is rejected, bypassing
    // the service layer entirely, proving the DB constraint itself, not just
    // requestAccountDeletion's own SELECT-then-INSERT pre-check.
    await expect(
      db.insert(schema.accountDeletionRequests).values({
        accountId: account.id,
        scheduledFor: new Date(),
      }),
    ).rejects.toThrow();

    // Once no longer PENDING, a fresh request for the same account is a
    // legitimate new cycle (cancel-then-request-again) and is allowed.
    await db
      .update(schema.accountDeletionRequests)
      .set({ status: 'CANCELLED' })
      .where(eq(schema.accountDeletionRequests.accountId, account.id));
    await expect(
      db.insert(schema.accountDeletionRequests).values({
        accountId: account.id,
        scheduledFor: new Date(),
      }),
    ).resolves.toBeDefined();
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
    const priorEntries = journalEntriesBefore(journal, '0024_strong_mother_askani');
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

describe('migration 0025 on an already-populated database (Codex review, PR-B1, finding #12)', () => {
  it('adds the lease columns and index without mutating any pre-existing erasure job — including CLAIMED/DELETED rows, which may belong to a still-live old deployment', async () => {
    // Simulate an "upgraded" database: apply every migration EXCEPT 0025
    // (the one adding lease_owner/lease_expires_at), insert one erasure_jobs
    // row per status — including CLAIMED and DELETED, the exact
    // intermediate states a worker mid-processing sits in — then apply 0025
    // and confirm every row's status is completely untouched.
    //
    // Round 2 (Codex review): this migration deliberately does NOT reset
    // CLAIMED/DELETED rows to PENDING, unlike the first version of this
    // fix. This repo's build command runs the migration before `next build`
    // (apps/web/vercel.json), so the OLD deployment is still live and
    // serving while this migration runs — a CLAIMED/DELETED row at that
    // exact moment could belong to a genuinely still-running old-code
    // worker, not an orphan. Resetting it immediately would let a second
    // old-code invocation claim and process the SAME job concurrently (the
    // old code's writes are gated only by row id, no status/lease check at
    // all), recreating the double-processing hazard leasing exists to
    // prevent. These rows are left exactly as they are — lease_owner/
    // lease_expires_at simply NULL, since the columns are new — and only
    // become reclaimable later via `claimErasureJobs`'s own age-gated
    // reclaim (proven in erasure.test.ts's "reclaims a CLAIMED job with no
    // lease at all once its claim is old enough" and its companion "does
    // NOT reclaim ... whose claim is still recent" test) once enough time
    // has passed that no legitimate worker could still be mid-flight.
    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    const priorEntries = journalEntriesBefore(journal, '0025_erasure_job_leasing');
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

    const seeded: { readonly id: string; readonly status: string }[] = [];
    const statuses = [
      'PENDING',
      'CLAIMED',
      'DELETED',
      'VERIFIED',
      'FAILED',
      'BLOCKED_BY_HOLD',
    ] as const;
    for (const [i, status] of statuses.entries()) {
      const storageObject = one(
        await db
          .insert(schema.storageObjects)
          .values({ bucket: 'CLEAN', objectKey: `untouched-${i}`, contentHash: 'c', sizeBytes: 1 })
          .returning(),
      );
      // Raw SQL, not `db.insert(schema.erasureJobs)`: the imported `schema`
      // module already reflects the POST-0025 shape (it's the same
      // schema.ts this test file's other describe blocks use), so a
      // drizzle-generated insert would reference lease_owner/
      // lease_expires_at — columns that genuinely do not exist yet in this
      // pre-0025 database.
      const inserted = await db.execute<{ id: string }>(sql`
        insert into erasure_jobs (reason, status, bucket, object_key, storage_object_id, claimed_at)
        values ('ACCOUNT_DELETION', ${status}, 'CLEAN', ${`untouched-${i}`}, ${storageObject.id}, '2026-01-01T00:00:00Z')
        returning id
      `);
      seeded.push({ id: one(inserted.rows).id, status });
    }

    // Applying the rest of the migrations (including 0025) against this
    // pre-existing state must not throw and must not mutate any row.
    await migrate(db, { migrationsFolder });

    for (const row of seeded) {
      const [current] = await db
        .select()
        .from(schema.erasureJobs)
        .where(eq(schema.erasureJobs.id, row.id));
      expect(current?.status).toBe(row.status);
      expect(current?.leaseOwner).toBeNull();
      expect(current?.leaseExpiresAt).toBeNull();
    }
  });
});
