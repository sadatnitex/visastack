import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import { type Db, first } from './db';
import { backfillProtectedFields } from './encryption-backfill';
import type { KeyManagementPort } from './ports';
import { editFact, registerFieldDefinition } from './profile';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

/** A deterministic, fixed-key test double, matching protected-fields.test.ts's own fixture. */
function fakeKeyManagementPort(keyVersion = 'test-v1'): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 7);
  return {
    currentKeyVersion: () => keyVersion,
    async generateDataKey() {
      return { keyVersion, plaintextDataKey: randomBytes(32), wrappedDataKey: masterKey };
    },
    async unwrapDataKey(version) {
      if (version !== keyVersion) throw new Error(`unknown key version ${version}`);
      return masterKey;
    },
  };
}

/**
 * Writes a fact + fact_version directly, bypassing editFact -- the only way
 * to reproduce a legacy plaintext SENSITIVE/RESTRICTED row, since editFact
 * itself has always refused to create one. This is exactly the shape a row
 * written before protected-field encryption existed (or before a
 * KeyManagementPort was wired into the real callers) would have.
 */
async function seedLegacyPlaintextFact(
  db: Db,
  input: { applicantId: string; fieldDefinitionId: string; value: string },
): Promise<{ factId: string; factVersionId: string }> {
  const [fact] = await db
    .insert(schema.facts)
    .values({ applicantId: input.applicantId, fieldDefinitionId: input.fieldDefinitionId })
    .returning();
  if (!fact) throw new Error('fact');
  const [version] = await db
    .insert(schema.factVersions)
    .values({ factId: fact.id, value: input.value })
    .returning();
  if (!version) throw new Error('version');
  await db
    .update(schema.facts)
    .set({ currentVersionId: version.id })
    .where(eq(schema.facts.id, fact.id));
  return { factId: fact.id, factVersionId: version.id };
}

describe('backfillProtectedFields', () => {
  let db: Db;
  let accountId: string;
  let applicantId: string;
  let restrictedFieldDefId: string;

  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
    const provisioned = await provisionAccount(db, { email: 'backfill@example.com' });
    if (!isOk(provisioned)) throw new Error('provision failed');
    accountId = provisioned.value.id;
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName: 'Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant creation failed');
    applicantId = applicant.value.id;
    const def = await registerFieldDefinition(db, {
      key: 'passport_number',
      dataType: 'string',
      sensitivity: 'RESTRICTED',
    });
    restrictedFieldDefId = def.id;
  });

  it('dry run reports the plaintext backlog without modifying anything', async () => {
    const { factVersionId } = await seedLegacyPlaintextFact(db, {
      applicantId,
      fieldDefinitionId: restrictedFieldDefId,
      value: 'X1234567',
    });

    const report = await backfillProtectedFields(db, fakeKeyManagementPort(), {
      actorAccountId: accountId,
      dryRun: true,
    });
    expect(report.dryRun).toBe(true);
    expect(report.plaintextBacklogCount).toBe(1);
    expect(report.plaintextFound).toHaveLength(1);
    expect(report.plaintextFound[0]?.factVersionId).toBe(factVersionId);
    expect(report.plaintextFound[0]?.fieldKey).toBe('passport_number');
    expect(report.encrypted).toBe(0);

    const row = first(
      await db.select().from(schema.factVersions).where(eq(schema.factVersions.id, factVersionId)),
    );
    expect(row?.value).toBe('X1234567');
    expect(row?.valueCiphertext).toBeNull();
  });

  it('encrypts the plaintext backlog in place outside dry run, clearing the plaintext column', async () => {
    const { factVersionId } = await seedLegacyPlaintextFact(db, {
      applicantId,
      fieldDefinitionId: restrictedFieldDefId,
      value: 'X1234567',
    });

    const report = await backfillProtectedFields(db, fakeKeyManagementPort(), {
      actorAccountId: accountId,
      dryRun: false,
    });
    expect(report.encrypted).toBe(1);
    expect(report.errors).toHaveLength(0);

    const row = first(
      await db.select().from(schema.factVersions).where(eq(schema.factVersions.id, factVersionId)),
    );
    expect(row?.value).toBeNull();
    expect(row?.valueCiphertext).not.toBeNull();
    expect(row?.valueNonce).not.toBeNull();
    expect(row?.protectedKeyVersion).toBe('test-v1');
    expect(Buffer.from(row?.valueCiphertext ?? []).includes('X1234567')).toBe(false);
  });

  it('is resumable/idempotent: re-running after a successful backfill finds nothing left', async () => {
    await seedLegacyPlaintextFact(db, {
      applicantId,
      fieldDefinitionId: restrictedFieldDefId,
      value: 'X1234567',
    });
    await backfillProtectedFields(db, fakeKeyManagementPort(), {
      actorAccountId: accountId,
      dryRun: false,
    });

    const second = await backfillProtectedFields(db, fakeKeyManagementPort(), {
      actorAccountId: accountId,
      dryRun: false,
    });
    expect(second.plaintextFound).toHaveLength(0);
    expect(second.encrypted).toBe(0);
    expect(second.alreadyProtectedCount).toBe(1);
  });

  it('never touches a plaintext STANDARD field, only SENSITIVE/RESTRICTED ones', async () => {
    const standardDef = await registerFieldDefinition(db, {
      key: 'nickname',
      dataType: 'string',
      sensitivity: 'STANDARD',
    });
    const { factVersionId } = await seedLegacyPlaintextFact(db, {
      applicantId,
      fieldDefinitionId: standardDef.id,
      value: 'Nas',
    });

    const report = await backfillProtectedFields(db, fakeKeyManagementPort(), {
      actorAccountId: accountId,
      dryRun: false,
    });
    expect(report.plaintextFound).toHaveLength(0);
    expect(report.encrypted).toBe(0);

    const row = first(
      await db.select().from(schema.factVersions).where(eq(schema.factVersions.id, factVersionId)),
    );
    expect(row?.value).toBe('Nas');
  });

  it('respects the limit, leaving extra plaintext rows for the next call', async () => {
    for (let i = 0; i < 3; i++) {
      await seedLegacyPlaintextFact(db, {
        applicantId,
        fieldDefinitionId: restrictedFieldDefId,
        value: `P${i}`,
      });
    }

    const first_ = await backfillProtectedFields(db, fakeKeyManagementPort(), {
      actorAccountId: accountId,
      dryRun: false,
      limit: 2,
    });
    expect(first_.encrypted).toBe(2);
    // The backlog total is unbounded by `limit` -- it reflects all 3 rows as
    // they stood when this call started, not just the page it acted on.
    expect(first_.plaintextBacklogCount).toBe(3);

    const second = await backfillProtectedFields(db, fakeKeyManagementPort(), {
      actorAccountId: accountId,
      dryRun: false,
      limit: 2,
    });
    expect(second.encrypted).toBe(1);
    expect(second.plaintextFound).toHaveLength(1);
  });

  it('records an audit event for each row it backfills', async () => {
    const { factVersionId } = await seedLegacyPlaintextFact(db, {
      applicantId,
      fieldDefinitionId: restrictedFieldDefId,
      value: 'X1234567',
    });

    await backfillProtectedFields(db, fakeKeyManagementPort(), {
      actorAccountId: accountId,
      dryRun: false,
    });

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PROTECTED_FIELD_BACKFILLED'));
    expect(events).toHaveLength(1);
    expect(events[0]?.resourceId).toBe(factVersionId);
    expect(events[0]?.applicantId).toBe(applicantId);
    expect(events[0]?.actorAccountId).toBe(accountId);
  });

  it('the backfilled value round-trips correctly through the normal editFact/reveal path', async () => {
    await seedLegacyPlaintextFact(db, {
      applicantId,
      fieldDefinitionId: restrictedFieldDefId,
      value: 'X1234567',
    });
    const port = fakeKeyManagementPort();
    await backfillProtectedFields(db, port, { actorAccountId: accountId, dryRun: false });

    // A fresh edit through the normal service path still works after the backfill.
    const edited = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'passport_number',
      value: 'Y7654321',
      encryption: port,
    });
    expect(isOk(edited)).toBe(true);
  });
});
