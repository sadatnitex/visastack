import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { listConsentHistory, setConsent } from './consent';
import type { Db } from './db';
import {
  cancelAccountDeletion,
  executeAccountDeletion,
  getPendingDeletion,
  requestAccountDeletion,
} from './deletion';
import { addDocumentVersion, registerDocument } from './documents';
import { runErasureWorker } from './erasure';
import { exportAccount } from './export';
import { grantPlatformRole } from './platform-roles';
import { editFact, registerFieldDefinition } from './profile';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

/** Deterministic in-memory blob store — no S3, no network. */
class FakeBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredBytes>();
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

/** Seed a consented account with an applicant carrying a fact and a document. */
async function seedFullAccount(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const account = provisioned.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
  await editFact(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    fieldKey: 'passport.number',
    value: 'A1',
  });
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'p.pdf',
  });
  if (!isOk(doc)) throw new Error('doc');
  await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `obj-${email}`,
  });
  return { account, applicantId: applicant.value.id };
}

describe('account export', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('assembles a full snapshot for the owner', async () => {
    const { account } = await seedFullAccount(db, 'exp@example.com');
    const result = await exportAccount(db, { actorAccountId: account.id, accountId: account.id });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.account.id).toBe(account.id);
    expect(result.value.consents.CORE_PROCESSING).toBe(true);
    expect(result.value.applicants).toHaveLength(1);
    expect(result.value.applicants[0]?.facts[0]?.versions).toHaveLength(1);
    expect(result.value.applicants[0]?.documents[0]?.versions).toHaveLength(1);
    expect(result.value.auditEvents.length).toBeGreaterThan(0);
  });

  it('refuses to export another account', async () => {
    const { account } = await seedFullAccount(db, 'exp2@example.com');
    const other = await provisionAccount(db, { email: 'other-exp@example.com' });
    if (!isOk(other)) throw new Error('provision');
    const result = await exportAccount(db, {
      actorAccountId: other.value.id,
      accountId: account.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });
});

describe('account deletion workflow', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('is reversible during the grace window', async () => {
    const { account } = await seedFullAccount(db, 'del1@example.com');
    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isOk(req)).toBe(true);

    // Too early to execute.
    const early = await executeAccountDeletion(db, { accountId: account.id });
    expect(isErr(early)).toBe(true);
    if (isErr(early)) expect(early.error.code).toBe('invalid');

    const cancelled = await cancelAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isOk(cancelled)).toBe(true);
    // Account still present.
    const rows = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id));
    expect(rows).toHaveLength(1);
  });

  it('executes after the window, removing owned data and preserving audit', async () => {
    const { account, applicantId } = await seedFullAccount(db, 'del2@example.com');
    const storage = new FakeBlobStore();
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-del2@example.com',
      contentType: 'application/pdf',
      bytes: new Uint8Array([9, 9, 9]),
    });
    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
      gracePeriodMs: 0,
    });
    expect(isOk(req)).toBe(true);

    const executed = await executeAccountDeletion(db, { accountId: account.id });
    expect(isOk(executed)).toBe(true);
    if (isOk(executed)) expect(executed.value.status).toBe('EXECUTED');

    // Account and applicant are gone immediately (the logical cascade).
    expect(
      await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.applicants).where(eq(schema.applicants.id, applicantId)),
    ).toHaveLength(0);
    // Storage objects survive the logical cascade — erasure.ts owns removing
    // them, only after the external bytes are verified deleted. One erasure
    // job is queued, carrying the object's bucket/key/hash independently of
    // the (already-gone) document version that used to reference it.
    expect(await db.select().from(schema.storageObjects)).toHaveLength(1);
    const jobs = await db.select().from(schema.erasureJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('PENDING');
    expect(jobs[0]?.reason).toBe('ACCOUNT_DELETION');

    // The worker completes the job: bytes deleted, verified, then (and only
    // then) the storage object row itself is removed.
    const workerResult = await runErasureWorker(db, storage, { limit: 5 });
    expect(workerResult).toEqual({ processed: 1, blocked: 0, failed: 0 });
    expect(await db.select().from(schema.storageObjects)).toHaveLength(0);
    expect(await storage.getObject('obj-del2@example.com')).toBeUndefined();

    // The audit trail is preserved (anonymized) and the tombstone remains.
    expect((await db.select().from(schema.auditEvents)).length).toBeGreaterThan(0);
    const tombstone = await db.select().from(schema.accountDeletionRequests);
    expect(tombstone[0]?.status).toBe('EXECUTED');
    expect(tombstone[0]?.accountId).toBeNull();
  });

  it('preserves platform-role grant history (anonymized) when the granted account is deleted (finding #17)', async () => {
    const { account } = await seedFullAccount(db, 'del-role@example.com');
    const bootstrapAuth = {
      accountId: account.id,
      email: 'del-role@example.com',
      bootstrapEmails: ['del-role@example.com'],
    };
    const granted = await grantPlatformRole(db, {
      actor: bootstrapAuth,
      targetAccountId: account.id,
      role: 'PLATFORM_OWNER',
      reason: 'bootstrap',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');

    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
      gracePeriodMs: 0,
    });
    expect(isOk(req)).toBe(true);
    const executed = await executeAccountDeletion(db, { accountId: account.id });
    expect(isOk(executed)).toBe(true);

    // The account is gone, but the role-history row survives with its
    // account reference nulled — never cascaded away — preserving the
    // append-only role-history invariant
    // (docs/audits/post-programme-defect-register.md finding #17).
    const roleRows = await db
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.id, granted.value.id));
    expect(roleRows).toHaveLength(1);
    expect(roleRows[0]?.accountId).toBeNull();
    expect(roleRows[0]?.role).toBe('PLATFORM_OWNER');
    expect(roleRows[0]?.workosUserId).toBe(granted.value.workosUserId);
  });

  it('refuses a deletion request for another account', async () => {
    const { account } = await seedFullAccount(db, 'del3@example.com');
    const other = await provisionAccount(db, { email: 'other-del@example.com' });
    if (!isOk(other)) throw new Error('provision');
    const result = await requestAccountDeletion(db, {
      actorAccountId: other.value.id,
      accountId: account.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('exposes the pending request via getPendingDeletion, cleared on cancel', async () => {
    const { account } = await seedFullAccount(db, 'del4@example.com');
    expect(await getPendingDeletion(db, account.id)).toBeUndefined();

    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isOk(req)).toBe(true);

    const pending = await getPendingDeletion(db, account.id);
    expect(pending?.status).toBe('PENDING');

    await cancelAccountDeletion(db, { actorAccountId: account.id, accountId: account.id });
    expect(await getPendingDeletion(db, account.id)).toBeUndefined();
  });
});

describe('consent history', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('records the full grant/revoke trail newest-first', async () => {
    const provisioned = await provisionAccount(db, { email: 'ch@example.com' });
    if (!isOk(provisioned)) throw new Error('provision');
    const accountId = provisioned.value.id;

    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'MARKETING',
      granted: true,
    });
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'MARKETING',
      granted: false,
    });

    const history = await listConsentHistory(db, accountId);
    expect(history).toHaveLength(3);
    // Newest first: the MARKETING revoke is the most recent row.
    expect(history[0]?.type).toBe('MARKETING');
    expect(history[0]?.revokedAt).not.toBeNull();
    expect(history[0]?.grantedAt).toBeNull();
  });
});
