import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountExportPorts,
  accountExportArtifactHours,
  enqueueAccountExportJob,
  getAccountExportArtifact,
  runAccountExportWorker,
  sweepExpiredAccountExportArtifacts,
} from './account-export';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import { type Db, first } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { enqueueErasureJob } from './erasure';
import type { KeyManagementPort } from './ports';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

/** Minimal in-memory blob store - same shape as erasure.test.ts's own fake, no failure injection needed here. */
class FakeBlobStore implements BlobStore {
  readonly objects = new Map<string, StoredBytes>();
  readonly deleteCalls: string[] = [];
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.deleteCalls.push(objectKey);
    this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

/** A deterministic, fixed-key test double - mirrors protected-fields.test.ts's own fakeKeyManagementPort. */
function fakeKeyManagementPort(keyVersion = 'export-test-v1'): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 9);
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

/** A trivial, deterministic bundler - proves this module wires bytes through the injected port correctly without depending on a real ZIP library (packages/services stays free of one; see zip-bundler.ts in packages/adapters for the real one). Base64-encodes rather than UTF-8-decoding each file's bytes, so it round-trips real (non-text) document bytes exactly - a lossy text decode would silently corrupt binary content long before any real ZIP library was involved. */
function fakeBundler() {
  return {
    async build(files: ReadonlyArray<{ readonly name: string; readonly bytes: Uint8Array }>) {
      return new TextEncoder().encode(
        JSON.stringify(
          files.map((f) => ({ name: f.name, base64: Buffer.from(f.bytes).toString('base64') })),
        ),
      );
    },
  };
}

/** Decodes one `fakeBundler` "zip" back into its files, for assertions. */
function decodeFakeBundle(bytes: Uint8Array): Array<{ name: string; base64: string }> {
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function seedAccountWithApplicant(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
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
    displayName: 'Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant failed');
  return { accountId: account.id, applicantId: applicant.value.id };
}

describe('account export jobs (PRV-04, master directive Part 7 §14 "Large export")', () => {
  let db: Db;
  let storage: FakeBlobStore;
  let ports: AccountExportPorts;

  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
    storage = new FakeBlobStore();
    ports = {
      blobStore: storage,
      keyManagement: fakeKeyManagementPort(),
      bundler: fakeBundler(),
    };
  });

  it('enqueueAccountExportJob is idempotent while a job is PENDING or CLAIMED', async () => {
    const { accountId } = await seedAccountWithApplicant(db, 'export-idem@example.com');
    const first_ = await enqueueAccountExportJob(db, accountId);
    const second = await enqueueAccountExportJob(db, accountId);
    expect(second.id).toBe(first_.id);
    const rows = await db
      .select()
      .from(schema.accountExportJobs)
      .where(eq(schema.accountExportJobs.accountId, accountId));
    expect(rows).toHaveLength(1);
  });

  it('runAccountExportWorker produces a READY job with a real, decryptable artifact containing the account’s own export data', async () => {
    const { accountId } = await seedAccountWithApplicant(db, 'export-happy@example.com');
    const job = await enqueueAccountExportJob(db, accountId);

    const result = await runAccountExportWorker(db, ports, { limit: 5 });
    expect(result).toEqual({ ready: 1, failed: 0 });

    const row = first(
      await db
        .select()
        .from(schema.accountExportJobs)
        .where(eq(schema.accountExportJobs.id, job.id)),
    );
    expect(row?.status).toBe('READY');
    expect(row?.bucket).toBe('CLEAN');
    expect(row?.objectKey).toBeTruthy();
    expect(row?.encryptionNonce).not.toBeNull();
    expect(row?.encryptionKeyVersion).toBe('export-test-v1');
    expect(row?.readyAt).not.toBeNull();
    expect(row?.expiresAt).not.toBeNull();
    const hoursUntilExpiry =
      (row?.expiresAt as Date).getTime() / 1000 / 3600 -
      (row?.readyAt as Date).getTime() / 1000 / 3600;
    expect(Math.round(hoursUntilExpiry)).toBe(accountExportArtifactHours());

    const artifact = await getAccountExportArtifact(db, ports, {
      actorAccountId: accountId,
      jobId: job.id,
    });
    expect(isOk(artifact)).toBe(true);
    if (!isOk(artifact)) return;
    const files = decodeFakeBundle(artifact.value.bytes);
    const manifestFile = files.find((f) => f.name === 'manifest.json');
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(
      Buffer.from(manifestFile?.base64 ?? '', 'base64').toString('utf-8'),
    );
    expect(manifest.counts.applicants).toBe(1);
    expect(files.some((f) => f.name === 'applicants.csv')).toBe(true);
  });

  it('a second worker pass after READY finds nothing left to do', async () => {
    const { accountId } = await seedAccountWithApplicant(db, 'export-second-pass@example.com');
    await enqueueAccountExportJob(db, accountId);
    await runAccountExportWorker(db, ports, { limit: 5 });
    const second = await runAccountExportWorker(db, ports, { limit: 5 });
    expect(second).toEqual({ ready: 0, failed: 0 });
  });

  it('enqueues a fresh job once the existing READY one has expired, rather than reusing it', async () => {
    const { accountId } = await seedAccountWithApplicant(db, 'export-reenqueue@example.com');
    const firstJob = await enqueueAccountExportJob(db, accountId);
    await runAccountExportWorker(db, ports, { limit: 5 });
    await db
      .update(schema.accountExportJobs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.accountExportJobs.id, firstJob.id));

    const secondJob = await enqueueAccountExportJob(db, accountId);
    expect(secondJob.id).not.toBe(firstJob.id);
  });

  it('fails closed (never stores an unencrypted artifact) when no key management port is configured', async () => {
    const { accountId } = await seedAccountWithApplicant(db, 'export-no-kms@example.com');
    await enqueueAccountExportJob(db, accountId);
    const noKmsPorts: AccountExportPorts = { ...ports, keyManagement: undefined };
    const result = await runAccountExportWorker(db, noKmsPorts, { limit: 5 });
    // 'failed' counts this attempt's own error path (matching erasure.ts's
    // identical convention), not "reached terminal FAILED" -- the row itself
    // is still PENDING with a fresh backoff, not yet exhausted (maxAttempts
    // defaults to 5; this is attempt 1).
    expect(result).toEqual({ ready: 0, failed: 1 });
    const row = first(await db.select().from(schema.accountExportJobs));
    expect(row?.status).toBe('PENDING');
    expect(row?.lastError).toMatch(/key management/);
    expect(storage.objects.size).toBe(0);
  });

  it('reaches FAILED (never retries forever) once maxAttempts is exhausted', async () => {
    const { accountId } = await seedAccountWithApplicant(db, 'export-exhausted@example.com');
    const job = await enqueueAccountExportJob(db, accountId);
    await db
      .update(schema.accountExportJobs)
      .set({ maxAttempts: 1 })
      .where(eq(schema.accountExportJobs.id, job.id));
    const noKmsPorts: AccountExportPorts = { ...ports, keyManagement: undefined };
    const result = await runAccountExportWorker(db, noKmsPorts, { limit: 5 });
    expect(result).toEqual({ ready: 0, failed: 1 });
    const row = first(await db.select().from(schema.accountExportJobs));
    expect(row?.status).toBe('FAILED');
  });

  it('skips (never retries) a job whose owning account no longer exists', async () => {
    const { accountId } = await seedAccountWithApplicant(db, 'export-orphaned@example.com');
    const job = await enqueueAccountExportJob(db, accountId);
    // Simulates account deletion's own `set null` FK behavior directly,
    // without needing to run the real (heavier) deletion cascade here.
    await db
      .update(schema.accountExportJobs)
      .set({ accountId: null })
      .where(eq(schema.accountExportJobs.id, job.id));

    const result = await runAccountExportWorker(db, ports, { limit: 5 });
    expect(result).toEqual({ ready: 0, failed: 0 });
    const row = first(await db.select().from(schema.accountExportJobs));
    expect(row?.status).toBe('FAILED');
    expect(row?.lastError).toMatch(/no longer exists/);
    expect(storage.objects.size).toBe(0); // never attempted to bundle/store anything
  });

  it('sweepExpiredAccountExportArtifacts deletes the blob and marks EXPIRED once past expiresAt, leaving a still-valid one untouched', async () => {
    const expired = await seedAccountWithApplicant(db, 'export-expired@example.com');
    const stillValid = await seedAccountWithApplicant(db, 'export-still-valid@example.com');
    const expiredJob = await enqueueAccountExportJob(db, expired.accountId);
    const validJob = await enqueueAccountExportJob(db, stillValid.accountId);
    await runAccountExportWorker(db, ports, { limit: 5 });
    await db
      .update(schema.accountExportJobs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.accountExportJobs.id, expiredJob.id));

    const result = await sweepExpiredAccountExportArtifacts(db, storage);
    expect(result).toEqual({ expired: 1 });

    const expiredRow = first(
      await db
        .select()
        .from(schema.accountExportJobs)
        .where(eq(schema.accountExportJobs.id, expiredJob.id)),
    );
    expect(expiredRow?.status).toBe('EXPIRED');
    const validRow = first(
      await db
        .select()
        .from(schema.accountExportJobs)
        .where(eq(schema.accountExportJobs.id, validJob.id)),
    );
    expect(validRow?.status).toBe('READY');
    expect(storage.objects.size).toBe(1); // only the expired one's blob was removed
  });

  it('immediately cleans up a READY job whose owning account is gone, regardless of expiresAt', async () => {
    const { accountId } = await seedAccountWithApplicant(db, 'export-account-gone@example.com');
    const job = await enqueueAccountExportJob(db, accountId);
    await runAccountExportWorker(db, ports, { limit: 5 });
    // expiresAt is still ~24h in the future - only accountId being null should trigger cleanup here.
    await db
      .update(schema.accountExportJobs)
      .set({ accountId: null })
      .where(eq(schema.accountExportJobs.id, job.id));

    const result = await sweepExpiredAccountExportArtifacts(db, storage);
    expect(result).toEqual({ expired: 1 });
    expect(storage.objects.size).toBe(0);
  });

  it('getAccountExportArtifact refuses a different account, an expired job, and a not-yet-ready job', async () => {
    const owner = await seedAccountWithApplicant(db, 'export-access-owner@example.com');
    const stranger = await seedAccountWithApplicant(db, 'export-access-stranger@example.com');
    const job = await enqueueAccountExportJob(db, owner.accountId);

    const beforeReady = await getAccountExportArtifact(db, ports, {
      actorAccountId: owner.accountId,
      jobId: job.id,
    });
    expect(isOk(beforeReady)).toBe(false);

    await runAccountExportWorker(db, ports, { limit: 5 });

    const wrongAccount = await getAccountExportArtifact(db, ports, {
      actorAccountId: stranger.accountId,
      jobId: job.id,
    });
    expect(isOk(wrongAccount)).toBe(false);

    await db
      .update(schema.accountExportJobs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.accountExportJobs.id, job.id));
    const expired = await getAccountExportArtifact(db, ports, {
      actorAccountId: owner.accountId,
      jobId: job.id,
    });
    expect(isOk(expired)).toBe(false);
  });
});

describe('account export document bytes (Chunk 2 -- real original document bytes in the artifact)', () => {
  let db: Db;
  let storage: FakeBlobStore;
  let ports: AccountExportPorts;

  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
    storage = new FakeBlobStore();
    ports = { blobStore: storage, keyManagement: fakeKeyManagementPort(), bundler: fakeBundler() };
  });

  /** Runs the worker for this account and returns the resulting artifact's decoded files. */
  async function exportAndDecode(accountId: string) {
    await enqueueAccountExportJob(db, accountId);
    await runAccountExportWorker(db, ports, { limit: 5 });
    const job = first(
      await db
        .select()
        .from(schema.accountExportJobs)
        .where(eq(schema.accountExportJobs.accountId, accountId)),
    );
    if (!job) throw new Error('no job');
    const artifact = await getAccountExportArtifact(db, ports, {
      actorAccountId: accountId,
      jobId: job.id,
    });
    if (!isOk(artifact)) throw new Error('artifact not ready');
    return decodeFakeBundle(artifact.value.bytes);
  }

  function manifestOf(files: Array<{ name: string; base64: string }>) {
    const manifestFile = files.find((f) => f.name === 'manifest.json');
    if (!manifestFile) throw new Error('no manifest.json in artifact');
    return JSON.parse(Buffer.from(manifestFile.base64, 'base64').toString('utf-8'));
  }

  it('bundles a usable document version’s real bytes under a safe, sanitized name, and closes the manifest’s known gap', async () => {
    const { accountId, applicantId } = await seedAccountWithApplicant(
      db,
      'export-doc-bytes@example.com',
    );
    const doc = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: '../../etc/passwd.pdf',
      docType: 'passport',
    });
    if (!isOk(doc)) throw new Error('doc');
    const version = await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'doc-1',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(version)) throw new Error('version');
    // Deliberately not valid UTF-8, proving the bytes ride through unmodified rather than as decoded/re-encoded text.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xc0, 0x80, 0xff]);
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'doc-1',
      contentType: 'application/pdf',
      bytes,
    });

    const files = await exportAndDecode(accountId);
    const docFile = files.find((f) => f.name.startsWith('documents/'));
    expect(docFile).toBeDefined();
    // Flattened to a single safe segment - no traversal, no directory escape.
    expect(docFile?.name).toBe('documents/etcpasswd - v1.pdf');
    expect(Buffer.from(docFile?.base64 ?? '', 'base64')).toEqual(Buffer.from(bytes));

    const manifest = manifestOf(files);
    expect(manifest.documentBytes).toEqual({ included: 1, excluded: [] });
    expect(
      manifest.knownGaps.some((g: { item: string }) => g.item === 'original document bytes'),
    ).toBe(false);
  });

  it('excludes a document version that has not yet cleared scanning, with an honest reason, never a silently smaller ZIP', async () => {
    const { accountId, applicantId } = await seedAccountWithApplicant(
      db,
      'export-doc-unscanned@example.com',
    );
    const doc = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'fresh-upload.pdf',
      docType: 'passport',
    });
    if (!isOk(doc)) throw new Error('doc');
    // No safetyStatus/processingStatus override: real defaults (PENDING/UPLOADING), matching a document still mid-pipeline.
    const version = await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'doc-unscanned',
    });
    if (!isOk(version)) throw new Error('version');
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'doc-unscanned',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });

    const files = await exportAndDecode(accountId);
    expect(files.some((f) => f.name.startsWith('documents/'))).toBe(false);

    const manifest = manifestOf(files);
    expect(manifest.documentBytes).toEqual({
      included: 0,
      excluded: [{ document: 'fresh-upload.pdf', version: 1, reason: 'not_yet_usable' }],
    });
    // Nothing was actually included, so the JSON export's own honest gap statement stays truthful.
    expect(
      manifest.knownGaps.some((g: { item: string }) => g.item === 'original document bytes'),
    ).toBe(true);
  });

  it('excludes a document version whose storage has already been erasure-verified, even though its own row still looks clean', async () => {
    const { accountId, applicantId } = await seedAccountWithApplicant(
      db,
      'export-doc-erased@example.com',
    );
    const doc = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'erased.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    const version = await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'doc-erased',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(version)) throw new Error('version');
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'doc-erased',
      contentType: 'application/pdf',
      bytes: new Uint8Array([9]),
    });
    const erasureJob = await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'doc-erased',
      expectedHash: null,
      storageObjectId: version.value.storageObject.id,
      documentId: doc.value.id,
      applicantId,
    });
    await db
      .update(schema.erasureJobs)
      .set({ status: 'VERIFIED', deletionAttemptedAt: new Date(), completedAt: new Date() })
      .where(eq(schema.erasureJobs.id, erasureJob.id));

    const files = await exportAndDecode(accountId);
    expect(files.some((f) => f.name.startsWith('documents/'))).toBe(false);
    const manifest = manifestOf(files);
    expect(manifest.documentBytes.excluded).toEqual([
      { document: 'erased.pdf', version: 1, reason: 'not_yet_usable' },
    ]);
  });

  it('deduplicates two documents that sanitize to the identical name and version number', async () => {
    const { accountId, applicantId } = await seedAccountWithApplicant(
      db,
      'export-doc-dup@example.com',
    );
    for (const objectKey of ['dup-a', 'dup-b']) {
      const doc = await registerDocument(db, {
        actorAccountId: accountId,
        applicantId,
        originalName: 'Passport.pdf',
        docType: 'passport',
      });
      if (!isOk(doc)) throw new Error('doc');
      const version = await addDocumentVersion(db, {
        actorAccountId: accountId,
        documentId: doc.value.id,
        bucket: 'CLEAN',
        objectKey,
        safetyStatus: 'CLEAN',
        processingStatus: 'AWAITING_REVIEW',
      });
      if (!isOk(version)) throw new Error('version');
      await storage.putObject({
        bucket: 'CLEAN',
        objectKey,
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode(objectKey),
      });
    }

    const files = await exportAndDecode(accountId);
    const docFiles = files.filter((f) => f.name.startsWith('documents/'));
    expect(docFiles).toHaveLength(2);
    expect(new Set(docFiles.map((f) => f.name)).size).toBe(2); // genuinely distinct entry names
    expect(docFiles.some((f) => f.name === 'documents/Passport - v1.pdf')).toBe(true);
    expect(docFiles.some((f) => f.name === 'documents/Passport - v1 (2).pdf')).toBe(true);
  });
});
