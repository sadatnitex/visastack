import { createHash } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { reconcileOrphans } from './reconciliation';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

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
  async listObjectKeys(input: { readonly bucket: StorageBucket }): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()].filter(() => input.bucket), cursor: undefined };
  }
}

async function seedAccount(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  return provisioned.value;
}

describe('orphan reconciliation', () => {
  let db: Db;
  let storage: FakeBlobStore;
  let officerId: string;
  beforeEach(async () => {
    db = await freshDb();
    storage = new FakeBlobStore();
    officerId = (await seedAccount(db, `officer-${Math.random()}@example.com`)).id;
  });

  it('detects a metadata row with no backing bytes, and cleans it up only outside dry run', async () => {
    const [object] = await db
      .insert(schema.storageObjects)
      .values({ bucket: 'CLEAN', objectKey: 'obj-orphan-meta', contentHash: null, sizeBytes: null })
      .returning();
    if (!object) throw new Error('object');

    const dryRun = await reconcileOrphans(db, storage, {
      actorAccountId: officerId,
      bucket: 'CLEAN',
      dryRun: true,
    });
    expect(dryRun.dbReferencesWithoutBlob).toEqual([object.id]);
    expect(dryRun.cleaned).toBe(0);
    expect(
      await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, object.id)),
    ).toHaveLength(1);

    const mutate = await reconcileOrphans(db, storage, {
      actorAccountId: officerId,
      bucket: 'CLEAN',
      dryRun: false,
    });
    expect(mutate.dbReferencesWithoutBlob).toEqual([object.id]);
    expect(mutate.cleaned).toBe(1);
    expect(
      await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, object.id)),
    ).toHaveLength(0);
  });

  it('never deletes a dangling metadata row that a document version still references', async () => {
    const account = await seedAccount(db, 'still-ref@example.com');
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
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.value.id,
      originalName: 'still-ref.pdf',
    });
    if (!isOk(doc)) throw new Error('doc');
    // A version is registered, but its bytes were never actually written to
    // the blob store — simulates an interrupted upload, not the fake's fault.
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'obj-still-referenced',
    });
    const [object] = await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.objectKey, 'obj-still-referenced'));
    if (!object) throw new Error('object');

    const report = await reconcileOrphans(db, storage, {
      actorAccountId: officerId,
      bucket: 'CLEAN',
      dryRun: false,
    });
    expect(report.dbReferencesWithoutBlob).toEqual([object.id]);
    expect(report.cleaned).toBe(0); // still referenced — the FK would refuse anyway
    expect(
      await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, object.id)),
    ).toHaveLength(1);
  });

  it('reports blobs with no DB reference, and never deletes them even outside dry run', async () => {
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-untracked',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });

    const report = await reconcileOrphans(db, storage, {
      actorAccountId: officerId,
      bucket: 'CLEAN',
      dryRun: false,
    });
    expect(report.blobsWithoutDbReference).toEqual(['obj-untracked']);
    // Report-only: still there after a mutate-mode run.
    expect(await storage.getObject('obj-untracked')).toBeDefined();
  });

  it('detects duplicate document-version references to the same storage object', async () => {
    const account = await seedAccount(db, 'dup@example.com');
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
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.value.id,
      originalName: 'dup.pdf',
    });
    if (!isOk(doc)) throw new Error('doc');
    const added = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'obj-dup',
    });
    if (!isOk(added)) throw new Error('version');
    // A second logical document's version pointing at the SAME storage
    // object is a genuine anomaly (never produced by addDocumentVersion,
    // which always mints a fresh key) — inserted directly to simulate it.
    const doc2 = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.value.id,
      originalName: 'dup2.pdf',
    });
    if (!isOk(doc2)) throw new Error('doc2');
    await db.insert(schema.documentVersions).values({
      documentId: doc2.value.id,
      storageObjectId: added.value.version.storageObjectId,
    });

    const report = await reconcileOrphans(db, storage, {
      actorAccountId: officerId,
      bucket: 'CLEAN',
      dryRun: true,
    });
    expect(report.duplicateReferences).toHaveLength(1);
    expect(report.duplicateReferences[0]?.storageObjectId).toBe(
      added.value.version.storageObjectId,
    );
    expect(report.duplicateReferences[0]?.documentVersionIds).toHaveLength(2);
  });

  it('detects a size/hash mismatch between recorded metadata and actual bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const realHash = createHash('sha256').update(bytes).digest('hex');
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-mismatch',
      contentType: 'application/pdf',
      bytes,
    });
    await db.insert(schema.storageObjects).values({
      bucket: 'CLEAN',
      objectKey: 'obj-mismatch',
      contentHash: `${realHash.slice(0, -1)}0`, // deliberately wrong
      sizeBytes: bytes.byteLength,
    });

    const report = await reconcileOrphans(db, storage, {
      actorAccountId: officerId,
      bucket: 'CLEAN',
      dryRun: true,
    });
    expect(report.sizeOrHashMismatches).toHaveLength(1);
    expect(report.sizeOrHashMismatches[0]?.objectKey).toBe('obj-mismatch');
    expect(report.sizeOrHashMismatches[0]?.detail).toContain('hash mismatch');
  });

  it('flags a VERIFIED erasure job whose bytes are somehow still present', async () => {
    const [object] = await db
      .insert(schema.storageObjects)
      .values({
        bucket: 'CLEAN',
        objectKey: 'obj-should-be-gone',
        contentHash: null,
        sizeBytes: null,
      })
      .returning();
    if (!object) throw new Error('object');
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-should-be-gone',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
    const [job] = await db
      .insert(schema.erasureJobs)
      .values({
        reason: 'ACCOUNT_DELETION',
        status: 'VERIFIED',
        bucket: 'CLEAN',
        objectKey: 'obj-should-be-gone',
        storageObjectId: object.id,
        completedAt: new Date(),
      })
      .returning();
    if (!job) throw new Error('job');

    const report = await reconcileOrphans(db, storage, {
      actorAccountId: officerId,
      bucket: 'CLEAN',
      dryRun: true,
    });
    expect(report.verifiedButStillPresent).toEqual([job.id]);
  });

  it('reports a clean bucket with everything empty and nothing cleaned', async () => {
    const report = await reconcileOrphans(db, storage, {
      actorAccountId: officerId,
      bucket: 'CLEAN',
      dryRun: false,
    });
    expect(report).toEqual({
      dryRun: false,
      dbReferencesWithoutBlob: [],
      blobsWithoutDbReference: [],
      duplicateReferences: [],
      sizeOrHashMismatches: [],
      verifiedButStillPresent: [],
      cleaned: 0,
    });
  });
});
