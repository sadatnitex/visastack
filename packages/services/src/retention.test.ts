import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { executeAccountDeletion, requestAccountDeletion } from './deletion';
import { addDocumentVersion, registerDocument } from './documents';
import { runErasureWorker } from './erasure';
import {
  documentsPastRetention,
  listActiveLegalHolds,
  placeLegalHold,
  purgeExpiredDocuments,
  releaseLegalHold,
  setRetentionPolicy,
} from './retention';
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

async function consentedApplicant(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
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
  return { account, applicantId: applicant.value.id };
}

/** A compliance/system operator account (its id is a real uuid). */
async function operator(db: Db, email: string): Promise<string> {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  return p.value.id;
}

describe('legal hold overrides deletion', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('blocks account deletion while an active hold exists, then allows it once released', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'hold@example.com');
    const officer = await operator(db, 'officer1@example.com');
    await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
      gracePeriodMs: 0,
    });

    const hold = await placeLegalHold(db, {
      actorAccountId: officer,
      applicantId,
      reason: 'litigation X',
      stepUpSatisfied: true,
    });
    expect(isOk(hold)).toBe(true);
    if (!isOk(hold)) return;

    const blocked = await executeAccountDeletion(db, { accountId: account.id });
    expect(isErr(blocked)).toBe(true);
    if (isErr(blocked)) expect(blocked.error.message).toContain('legal hold');
    // Account still present.
    expect(
      await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)),
    ).toHaveLength(1);

    await releaseLegalHold(db, {
      actorAccountId: officer,
      holdId: hold.value.id,
      stepUpSatisfied: true,
    });
    const executed = await executeAccountDeletion(db, { accountId: account.id });
    expect(isOk(executed)).toBe(true);
    expect(
      await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)),
    ).toHaveLength(0);
  });

  it('lists only active legal holds via listActiveLegalHolds', async () => {
    const { applicantId } = await consentedApplicant(db, 'active-hold@example.com');
    const officer = await operator(db, 'officer-active@example.com');

    const hold = await placeLegalHold(db, {
      actorAccountId: officer,
      applicantId,
      reason: 'audit',
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold');

    expect(await listActiveLegalHolds(db)).toHaveLength(1);

    await releaseLegalHold(db, {
      actorAccountId: officer,
      holdId: hold.value.id,
      stepUpSatisfied: true,
    });
    expect(await listActiveLegalHolds(db)).toHaveLength(0);
  });

  it('refuses to place or release a legal hold without step-up (master directive §7 "PR 5")', async () => {
    const { applicantId } = await consentedApplicant(db, 'stepup-hold@example.com');
    const officer = await operator(db, 'officer-stepup@example.com');

    const deniedPlace = await placeLegalHold(db, {
      actorAccountId: officer,
      applicantId,
      reason: 'no reauth yet',
      stepUpSatisfied: false,
    });
    expect(isErr(deniedPlace)).toBe(true);
    if (isErr(deniedPlace)) expect(deniedPlace.error.code).toBe('step_up_required');
    expect(await listActiveLegalHolds(db)).toHaveLength(0);

    const hold = await placeLegalHold(db, {
      actorAccountId: officer,
      applicantId,
      reason: 'genuine hold',
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold');

    const deniedRelease = await releaseLegalHold(db, {
      actorAccountId: officer,
      holdId: hold.value.id,
      stepUpSatisfied: false,
    });
    expect(isErr(deniedRelease)).toBe(true);
    if (isErr(deniedRelease)) expect(deniedRelease.error.code).toBe('step_up_required');
    expect(await listActiveLegalHolds(db)).toHaveLength(1); // still active
  });
});

describe('retention purge', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("queues documents past their retention for erasure, but never a held applicant's", async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ret@example.com');
    const officer = await operator(db, 'officer2@example.com');
    const storage = new FakeBlobStore();
    await setRetentionPolicy(db, {
      actorAccountId: account.id,
      docType: 'receipt',
      retentionDays: 30,
    });

    // A receipt document with a version, and real bytes behind its object key.
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'r.pdf',
      docType: 'receipt',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'obj-ret',
    });
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-ret',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });
    // Backdate its creation beyond the retention window.
    await db.execute(
      sql`update documents set created_at = now() - interval '60 days' where id = ${doc.value.id}`,
    );

    // Eligible now.
    expect(await documentsPastRetention(db)).toHaveLength(1);

    // A legal hold makes it ineligible.
    const hold = await placeLegalHold(db, {
      actorAccountId: officer,
      applicantId,
      reason: 'hold',
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold');
    expect(await documentsPastRetention(db)).toHaveLength(0);
    const noop = await purgeExpiredDocuments(db, {
      actorAccountId: officer,
      stepUpSatisfied: true,
    });
    expect(isOk(noop)).toBe(true);
    if (isOk(noop)) {
      expect(noop.value.queuedForErasure).toBe(0);
      expect(noop.value.blockedByHold).toBe(0);
    }

    // Release the hold → purge queues erasure, but never deletes synchronously.
    await releaseLegalHold(db, {
      actorAccountId: officer,
      holdId: hold.value.id,
      stepUpSatisfied: true,
    });
    const purged = await purgeExpiredDocuments(db, {
      actorAccountId: officer,
      stepUpSatisfied: true,
    });
    expect(isOk(purged)).toBe(true);
    if (isOk(purged)) {
      expect(purged.value.queuedForErasure).toBe(1);
      expect(purged.value.blockedByHold).toBe(0);
    }
    // Nothing is "deleted" yet — bytes haven't been verified gone.
    expect(await db.select().from(schema.documents)).toHaveLength(1);
    expect(await db.select().from(schema.storageObjects)).toHaveLength(1);
    const queued = await db.select().from(schema.erasureJobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe('PENDING');
    expect(queued[0]?.reason).toBe('RETENTION_PURGE');

    // The worker deletes, verifies, and only then removes the document/object.
    const result = await runErasureWorker(db, storage, { limit: 5 });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    expect(await db.select().from(schema.documents)).toHaveLength(0);
    expect(await db.select().from(schema.storageObjects)).toHaveLength(0);
    expect(await storage.getObject('obj-ret')).toBeUndefined();
    const finalJob = (await db.select().from(schema.erasureJobs))[0];
    expect(finalJob?.status).toBe('VERIFIED');
  });

  it('blocks the erasure worker (not the queue step) when a hold appears after queuing', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ret-race@example.com');
    const officer = await operator(db, 'officer-race@example.com');
    const storage = new FakeBlobStore();
    await setRetentionPolicy(db, {
      actorAccountId: account.id,
      docType: 'receipt',
      retentionDays: 30,
    });
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'r2.pdf',
      docType: 'receipt',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'obj-ret-race',
    });
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-ret-race',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
    await db.execute(
      sql`update documents set created_at = now() - interval '60 days' where id = ${doc.value.id}`,
    );

    const purged = await purgeExpiredDocuments(db, {
      actorAccountId: officer,
      stepUpSatisfied: true,
    });
    expect(isOk(purged)).toBe(true);
    if (isOk(purged)) expect(purged.value.queuedForErasure).toBe(1);

    // A hold lands after the job is already queued, before the worker runs.
    const hold = await placeLegalHold(db, {
      actorAccountId: officer,
      applicantId,
      reason: 'late hold',
      stepUpSatisfied: true,
    });
    expect(isOk(hold)).toBe(true);

    const result = await runErasureWorker(db, storage, { limit: 5 });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    // Nothing was touched: bytes, document, and storage object all survive.
    expect(await storage.getObject('obj-ret-race')).toBeDefined();
    expect(await db.select().from(schema.documents)).toHaveLength(1);
    const job = (await db.select().from(schema.erasureJobs))[0];
    expect(job?.status).toBe('BLOCKED_BY_HOLD');
  });

  it('refuses to run retention purge without step-up, queuing nothing (master directive §7 "PR 5")', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'stepup-purge@example.com');
    const officer = await operator(db, 'officer-purge-stepup@example.com');
    await setRetentionPolicy(db, {
      actorAccountId: account.id,
      docType: 'receipt',
      retentionDays: 30,
    });
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'r3.pdf',
      docType: 'receipt',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'obj-ret-stepup',
    });
    await db.execute(
      sql`update documents set created_at = now() - interval '60 days' where id = ${doc.value.id}`,
    );
    expect(await documentsPastRetention(db)).toHaveLength(1);

    const denied = await purgeExpiredDocuments(db, {
      actorAccountId: officer,
      stepUpSatisfied: false,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('step_up_required');
    expect(await db.select().from(schema.erasureJobs)).toHaveLength(0);
  });
});
