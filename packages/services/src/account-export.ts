import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { exportAccount } from './export';
import { buildExportCsvTables } from './export-csv';
import type { KeyManagementPort } from './ports';
import { buildAccountExportAad, protectBytes, revealBytes } from './protected-fields';
import type { BlobStore } from './storage';

/**
 * Account export jobs (PRV-04, master directive Part 7 §14 "Large export") -
 * the async, durable counterpart to `exportAccount`'s existing synchronous
 * JSON/CSV export. Mirrors `erasure.ts`'s lease/claim/backoff shape closely
 * (see that file's own doc comment for the full rationale - every write
 * past the initial claim is compare-and-set on `leaseOwner`, so a worker
 * that outlives its own lease can never stomp whichever invocation reclaimed
 * the job next), with two states erasure never needed: READY (bundling and
 * encryption complete, artifact downloadable until `expiresAt`) and EXPIRED
 * (was READY, now past `expiresAt`; bytes purged by the sweep below).
 *
 * Chunk 1 of this feature: the full job lifecycle (enqueue, claim, process,
 * retrieve, expire), producing a real, encrypted, transiently-stored
 * artifact - but bundling today's existing JSON manifest + CSV tables only,
 * the exact same content `exportAccount`'s synchronous route already
 * serves. Original document bytes (the actual point of "Large export") are
 * a separate, later chunk that only needs to change what `processExport`
 * bundles - the job lifecycle, encryption, storage, expiry, and retrieval
 * built here do not change. No HTTP route or UI exists yet either - this is
 * proven end-to-end at the service layer first, the same backend-then-UI
 * split this codebase has used throughout (e.g. TRU-02).
 *
 * The artifact is encrypted with `protectBytes`/`revealBytes`
 * (`protected-fields.ts`) - the same envelope-encryption primitive SEC-03
 * already uses for protected profile fields, generalized to an arbitrary
 * byte buffer rather than a string field value. It is stored via the same
 * `BlobStore` real documents use (bucket `CLEAN`, since this is a
 * system-generated artifact, never user-uploaded-unscanned content) rather
 * than inventing a second byte-storage mechanism - `erasure.ts`'s own
 * `deleteObject` is directly reusable for the expiry sweep below, and
 * `createStorage()`'s existing fail-closed rule (a real deployment must
 * configure real blob storage) already covers this artifact too, for the
 * same reason it covers every other document's bytes.
 */

export type AccountExportJob = typeof schema.accountExportJobs.$inferSelect;

/** A ZIP bundle builder, injected so this module stays free of a concrete ZIP library dependency (matching `BlobStore`/`KeyManagementPort`'s own injected-port shape). */
export interface ZipBundler {
  build(
    files: ReadonlyArray<{ readonly name: string; readonly bytes: Uint8Array }>,
  ): Promise<Uint8Array>;
}

export interface AccountExportPorts {
  readonly blobStore: BlobStore;
  readonly keyManagement: KeyManagementPort | undefined;
  readonly bundler: ZipBundler;
}

const DEFAULT_CLAIM_LIMIT = 5;
const BACKOFF_BASE_SECONDS = 30;
/** Mirrors erasure.ts's own LEASE_DURATION_MS - generous relative to one job's real work (one export assembly + one ZIP build + one encrypt + one blob write). */
const LEASE_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_ARTIFACT_HOURS = 24;

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/** How long a READY artifact stays downloadable before the expiry sweep purges it. Env-overridable like every other numeric retention default in this codebase. */
export function accountExportArtifactHours(): number {
  const raw = readEnv('ACCOUNT_EXPORT_ARTIFACT_HOURS');
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ARTIFACT_HOURS;
}

/** A job actively in flight, or a still-valid completed one - a fresh enqueue request against either is redundant, not a new request. */
async function findReusableJob(db: Db, accountId: string): Promise<AccountExportJob | undefined> {
  return first(
    await db
      .select()
      .from(schema.accountExportJobs)
      .where(
        and(
          eq(schema.accountExportJobs.accountId, accountId),
          or(
            inArray(schema.accountExportJobs.status, ['PENDING', 'CLAIMED']),
            and(
              eq(schema.accountExportJobs.status, 'READY'),
              gt(schema.accountExportJobs.expiresAt, sql`now()`),
            ),
          ),
        ),
      )
      .limit(1),
  );
}

/** Queue one account export. Idempotent: an in-flight job, or a still-valid READY one, is returned unchanged rather than duplicated. */
export async function enqueueAccountExportJob(
  db: Db,
  accountId: string,
): Promise<AccountExportJob> {
  const existing = await findReusableJob(db, accountId);
  if (existing) return existing;
  return required(
    first(await db.insert(schema.accountExportJobs).values({ accountId }).returning()),
    'account export job',
  );
}

function backoffSeconds(attemptsSoFar: number): number {
  return BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attemptsSoFar - 1);
}

/** Claim up to `limit` due jobs in one transaction - identical shape to `erasure.ts`'s `claimErasureJobs`, see its own doc comment for the full race-safety reasoning. */
async function claimAccountExportJobs(db: Db, limit: number): Promise<AccountExportJob[]> {
  const leaseOwner = randomUUID();
  return db.transaction(async (tx) => {
    await tx
      .update(schema.accountExportJobs)
      .set({ status: 'PENDING', leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.accountExportJobs.status, 'CLAIMED'),
          lt(schema.accountExportJobs.leaseExpiresAt, sql`now()`),
        ),
      );

    const due = await tx
      .select({ id: schema.accountExportJobs.id })
      .from(schema.accountExportJobs)
      .where(
        and(
          eq(schema.accountExportJobs.status, 'PENDING'),
          lte(schema.accountExportJobs.availableAt, sql`now()`),
        ),
      )
      .orderBy(asc(schema.accountExportJobs.availableAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    if (due.length === 0) return [];

    const now = new Date();
    return tx
      .update(schema.accountExportJobs)
      .set({
        status: 'CLAIMED',
        claimedAt: now,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
        attempts: sql`${schema.accountExportJobs.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        inArray(
          schema.accountExportJobs.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
  });
}

/** Compare-and-set like `erasure.ts`'s `failErasureJob` - a lost lease is a safe no-op, not an error. */
async function failAccountExportJob(
  db: Db,
  job: AccountExportJob,
  leaseOwner: string,
  errorMessage: string,
): Promise<boolean> {
  const exhausted = job.attempts >= job.maxAttempts;
  const updated = await db
    .update(schema.accountExportJobs)
    .set({
      status: exhausted ? 'FAILED' : 'PENDING',
      lastError: errorMessage.slice(0, 2000),
      leaseOwner: null,
      leaseExpiresAt: null,
      ...(exhausted
        ? {}
        : { availableAt: new Date(Date.now() + backoffSeconds(job.attempts) * 1000) }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.accountExportJobs.id, job.id),
        eq(schema.accountExportJobs.status, 'CLAIMED'),
        eq(schema.accountExportJobs.leaseOwner, leaseOwner),
      ),
    )
    .returning({ id: schema.accountExportJobs.id });
  return updated.length > 0;
}

type ProcessOutcome = 'ready' | 'skipped' | 'failed' | 'lost-lease';

/**
 * Process one claimed job: assemble the export, bundle it, encrypt it, store
 * it, and mark READY - or fail it (backoff/FAILED) on any error. Never
 * throws. A job whose owning account is already gone (`accountId` was
 * `set null`'d by account deletion - see the schema's own comment) is
 * `skipped`, not retried: there is nothing left to export, and it will be
 * cleaned up by the expiry sweep below regardless of `expiresAt`.
 */
async function processAccountExportJob(
  db: Db,
  ports: AccountExportPorts,
  job: AccountExportJob,
  leaseOwner: string,
): Promise<ProcessOutcome> {
  try {
    if (!job.accountId) {
      const skipped = await db
        .update(schema.accountExportJobs)
        .set({ status: 'FAILED', lastError: 'account no longer exists', updatedAt: new Date() })
        .where(
          and(
            eq(schema.accountExportJobs.id, job.id),
            eq(schema.accountExportJobs.status, 'CLAIMED'),
            eq(schema.accountExportJobs.leaseOwner, leaseOwner),
          ),
        )
        .returning({ id: schema.accountExportJobs.id });
      return skipped.length > 0 ? 'skipped' : 'lost-lease';
    }
    if (!ports.keyManagement) {
      throw new Error(
        'account export requires protected-artifact encryption; no key management port was configured',
      );
    }

    const exported = await exportAccount(db, {
      actorAccountId: job.accountId,
      accountId: job.accountId,
    });
    if (!exported.ok)
      throw new Error(`export failed (${exported.error.code}): ${exported.error.message}`);

    const files = [
      {
        name: 'manifest.json',
        bytes: new TextEncoder().encode(JSON.stringify(exported.value.manifest, null, 2)),
      },
      ...buildExportCsvTables(exported.value)
        .filter((table) => table.rowCount > 0)
        .map((table) => ({ name: table.name, bytes: new TextEncoder().encode(table.csv) })),
    ];
    const zipBytes = await ports.bundler.build(files);
    const protectedArtifact = await protectBytes(
      db,
      ports.keyManagement,
      zipBytes,
      buildAccountExportAad({ jobId: job.id }),
    );

    // Keyed by leaseOwner (a fresh token per claim invocation), never just
    // jobId -- so a lost-lease cleanup below only ever deletes THIS
    // attempt's own blob, never one a concurrent winning invocation wrote
    // under the same job id.
    const objectKey = `exports/${job.id}-${leaseOwner}.zip.enc`;
    await ports.blobStore.putObject({
      bucket: 'CLEAN',
      objectKey,
      contentType: 'application/octet-stream',
      bytes: protectedArtifact.ciphertext,
    });

    const now = new Date();
    const readied = await db
      .update(schema.accountExportJobs)
      .set({
        status: 'READY',
        bucket: 'CLEAN',
        objectKey,
        encryptionNonce: protectedArtifact.nonce,
        encryptionKeyVersion: protectedArtifact.keyVersion,
        readyAt: now,
        expiresAt: new Date(now.getTime() + accountExportArtifactHours() * 60 * 60 * 1000),
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.accountExportJobs.id, job.id),
          eq(schema.accountExportJobs.status, 'CLAIMED'),
          eq(schema.accountExportJobs.leaseOwner, leaseOwner),
        ),
      )
      .returning({ id: schema.accountExportJobs.id });
    if (readied.length === 0) {
      // Lost the lease after already writing the blob -- clean up this
      // attempt's own orphaned write; a concurrent winner's own write (a
      // different objectKey, above) is untouched.
      await ports.blobStore.deleteObject('CLEAN', objectKey);
      return 'lost-lease';
    }
    return 'ready';
  } catch (error) {
    const failed = await failAccountExportJob(
      db,
      job,
      leaseOwner,
      error instanceof Error ? error.message : String(error),
    );
    return failed ? 'failed' : 'lost-lease';
  }
}

export interface AccountExportWorkerResult {
  readonly ready: number;
  readonly failed: number;
}

/** Claim and run up to `limit` due account export jobs. Safe to call opportunistically (right after a request) and from a periodic sweep. */
export async function runAccountExportWorker(
  db: Db,
  ports: AccountExportPorts,
  options: { readonly limit?: number } = {},
): Promise<AccountExportWorkerResult> {
  const jobs = await claimAccountExportJobs(db, options.limit ?? DEFAULT_CLAIM_LIMIT);
  let ready = 0;
  let failed = 0;
  for (const job of jobs) {
    const leaseOwner = job.leaseOwner;
    if (!leaseOwner) continue; // claimAccountExportJobs always sets one; satisfies the type.
    const outcome = await processAccountExportJob(db, ports, job, leaseOwner);
    if (outcome === 'ready') ready++;
    else if (outcome === 'failed') failed++;
    // 'skipped'/'lost-lease': not this invocation's outcome to count.
  }
  return { ready, failed };
}

export interface AccountExportExpirySweepResult {
  readonly expired: number;
}

/**
 * Purge artifacts past their `expiresAt`, and any whose owning account is
 * already gone (`accountId IS NULL` - see the schema's own comment on why
 * this can't wait for the normal 24h clock). `BlobStore.deleteObject` is
 * documented idempotent, so a job with no artifact ever written (bucket/
 * objectKey still null, e.g. a FAILED job) is handled the same way as one
 * with a real blob to remove.
 */
export async function sweepExpiredAccountExportArtifacts(
  db: Db,
  blobStore: BlobStore,
  limit = 50,
): Promise<AccountExportExpirySweepResult> {
  const due = await db
    .select()
    .from(schema.accountExportJobs)
    .where(
      and(
        eq(schema.accountExportJobs.status, 'READY'),
        or(
          lt(schema.accountExportJobs.expiresAt, sql`now()`),
          isNull(schema.accountExportJobs.accountId),
        ),
      ),
    )
    .limit(limit);

  let expired = 0;
  for (const job of due) {
    if (job.bucket && job.objectKey) {
      await blobStore.deleteObject(job.bucket, job.objectKey);
    }
    const updated = await db
      .update(schema.accountExportJobs)
      .set({ status: 'EXPIRED', updatedAt: new Date() })
      .where(
        and(eq(schema.accountExportJobs.id, job.id), eq(schema.accountExportJobs.status, 'READY')),
      )
      .returning({ id: schema.accountExportJobs.id });
    if (updated.length > 0) expired++;
  }
  return { expired };
}

/** Every export job for this account, newest first - for a future status UI and for tests. Owner-scoped by construction (the WHERE clause), no separate authorization check needed. */
export async function listAccountExportJobsForAccount(
  db: Db,
  accountId: string,
): Promise<AccountExportJob[]> {
  return db
    .select()
    .from(schema.accountExportJobs)
    .where(eq(schema.accountExportJobs.accountId, accountId))
    .orderBy(sql`${schema.accountExportJobs.createdAt} desc`);
}

export interface AccountExportArtifact {
  readonly bytes: Uint8Array;
  readonly readyAt: Date;
  readonly expiresAt: Date;
}

/**
 * Retrieve and decrypt a READY artifact - "current access rechecked at
 * download" (directive's own words) done here, at the one chokepoint every
 * caller (today's tests, a future HTTP route) must go through, not left to
 * each caller to reimplement. `accountId` must be the account that owns the
 * job (self-service only, matching `exportAccount`'s own invariant); an
 * expired-but-not-yet-swept row (a race against the sweep) is refused
 * exactly like an already-swept one -- `expiresAt` is authoritative, not
 * merely advisory for the sweep alone.
 */
export async function getAccountExportArtifact(
  db: Db,
  ports: Pick<AccountExportPorts, 'blobStore' | 'keyManagement'>,
  input: { readonly actorAccountId: string; readonly jobId: string },
): Promise<Result<AccountExportArtifact, ServiceError>> {
  const job = first(
    await db
      .select()
      .from(schema.accountExportJobs)
      .where(eq(schema.accountExportJobs.id, input.jobId))
      .limit(1),
  );
  if (!job || job.accountId !== input.actorAccountId) {
    return err(serviceError('not_found', 'export job not found'));
  }
  if (job.status !== 'READY' || !job.expiresAt || job.expiresAt.getTime() <= Date.now()) {
    return err(serviceError('not_found', 'export artifact is not ready or has expired'));
  }
  if (!job.bucket || !job.objectKey || !job.encryptionNonce || !job.encryptionKeyVersion) {
    return err(serviceError('invalid', 'export job is READY but missing artifact fields'));
  }
  if (!ports.keyManagement) {
    return err(serviceError('encryption_unavailable', 'no key management port was configured'));
  }
  const stored = await ports.blobStore.getObject(job.objectKey);
  if (!stored) return err(serviceError('not_found', 'export artifact bytes are missing'));

  const bytes = await revealBytes(db, ports.keyManagement, {
    ciphertext: stored.bytes,
    nonce: job.encryptionNonce,
    keyVersion: job.encryptionKeyVersion,
    aad: buildAccountExportAad({ jobId: job.id }),
  });
  if (!job.readyAt) return err(serviceError('invalid', 'export job is READY but missing readyAt'));
  return ok({ bytes, readyAt: job.readyAt, expiresAt: job.expiresAt });
}
