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

/** A trivial, deterministic bundler - proves this module wires bytes through the injected port correctly without depending on a real ZIP library (packages/services stays free of one; see zip-bundler.ts in packages/adapters for the real one). */
function fakeBundler() {
  return {
    async build(files: ReadonlyArray<{ readonly name: string; readonly bytes: Uint8Array }>) {
      return new TextEncoder().encode(
        JSON.stringify(
          files.map((f) => ({ name: f.name, text: new TextDecoder().decode(f.bytes) })),
        ),
      );
    },
  };
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
    const files = JSON.parse(new TextDecoder().decode(artifact.value.bytes)) as Array<{
      name: string;
      text: string;
    }>;
    const manifestFile = files.find((f) => f.name === 'manifest.json');
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(manifestFile?.text ?? '{}');
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
