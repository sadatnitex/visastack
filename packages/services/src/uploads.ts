import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { type Db, first, required, schema } from './db';
import { checkStorageEntitlement } from './entitlement-enforcement';
import { type ServiceError, serviceError } from './errors';
import type { ObservabilityPort } from './ports';
import {
  type UploadQuotaConfig,
  getAccountEvidenceBytes,
  getApplicantEvidenceBytes,
  getPlatformEvidenceBytes,
  loadUploadQuotaConfig,
  mbLabel,
} from './quotas';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
import type { BlobStore } from './storage';

/**
 * Upload consistency (master directive §7 "PR 6"): server-created upload
 * intent → quota reservation → opaque object key → private upload →
 * server-side size verification → logical document/version creation → job
 * enqueue → reservation finalization. On any failure: release the
 * reservation, delete the partial blob if one was written, mark the intent
 * failed, and surface a recoverable error — never an invisible orphan
 * (a document row nobody can complete, or bytes nobody's metadata points
 * to).
 *
 * `reserveUpload`/`finalizeUpload`/`failUpload` own the intent's lifecycle;
 * the caller (apps/web's upload action) owns the actual blob write and
 * document/version creation in between, since those need the storage port
 * and the rest of the document-vault services this package already exposes.
 */

/** Reservations expire well past any realistic upload duration (network PUT + a verifying read + a few inserts) so an abandoned upload cannot hold quota hostage indefinitely, with no separate cleanup sweep required. */
const RESERVATION_TTL_MS = 10 * 60 * 1000;

export type UploadIntent = typeof schema.uploadIntents.$inferSelect;

/**
 * The one platform-wide lock every reservation change takes, held until its transaction ends, so
 * quota checks and the reservation they allow happen as one step.
 */
async function lockUploadQuota(tx: Db): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('visastack:upload-quota'))`);
}

async function activeReservedBytesFor(
  db: Db,
  column: 'accountId' | 'applicantId',
  id: string,
): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${schema.uploadIntents.reservedBytes}), 0)` })
    .from(schema.uploadIntents)
    .where(
      and(
        eq(schema.uploadIntents[column], id),
        eq(schema.uploadIntents.status, 'RESERVED'),
        gt(schema.uploadIntents.expiresAt, sql`now()`),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

async function activePlatformReservedBytes(db: Db): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${schema.uploadIntents.reservedBytes}), 0)` })
    .from(schema.uploadIntents)
    .where(
      and(
        eq(schema.uploadIntents.status, 'RESERVED'),
        gt(schema.uploadIntents.expiresAt, sql`now()`),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Every quota tier (per-applicant, per-account, platform, then each organization's plan) checked
 * against committed bytes plus every active reservation plus `addedBytes`. Runs inside the
 * caller's transaction, which must already hold the platform-wide upload lock.
 */
async function checkQuotaTiers(
  tx: Db,
  input: { readonly accountId: string; readonly applicantId: string },
  addedBytes: number,
  config: UploadQuotaConfig,
): Promise<Result<void, ServiceError>> {
  const applicantReserved = await activeReservedBytesFor(tx, 'applicantId', input.applicantId);
  const applicantCommitted = await getApplicantEvidenceBytes(tx, input.applicantId);
  if (applicantCommitted + applicantReserved + addedBytes > config.maxApplicantEvidenceBytes) {
    return err(
      serviceError(
        'invalid',
        `this applicant has reached its ${mbLabel(config.maxApplicantEvidenceBytes)} evidence limit`,
      ),
    );
  }

  const accountReserved = await activeReservedBytesFor(tx, 'accountId', input.accountId);
  const accountCommitted = await getAccountEvidenceBytes(tx, input.accountId);
  if (accountCommitted + accountReserved + addedBytes > config.maxAccountEvidenceBytes) {
    return err(
      serviceError(
        'invalid',
        `this account has reached its ${mbLabel(config.maxAccountEvidenceBytes)} evidence limit`,
      ),
    );
  }

  const platformReserved = await activePlatformReservedBytes(tx);
  const platformCommitted = await getPlatformEvidenceBytes(tx);
  if (platformCommitted + platformReserved + addedBytes > config.platformHardStopBytes) {
    return err(
      serviceError(
        'invalid',
        'platform storage capacity reached; new uploads are temporarily paused',
      ),
    );
  }

  // COM-02: a fifth, org-scoped tier layered on top of the four
  // infrastructure-level ones above -- a plan's storageBytesAllowed, for
  // every organization with current grant access to this applicant.
  // Reuses the caller's already-held platform-wide lock; no separate one
  // needed.
  const orgCheck = await checkStorageEntitlement(tx, input.applicantId, addedBytes);
  if (!orgCheck.ok) return err(orgCheck.error);
  return ok(undefined);
}

export interface ReserveUploadInput {
  readonly accountId: string;
  readonly applicantId: string;
  readonly sizeBytes: number;
}

/**
 * Atomically check every quota tier (per-file, per-applicant, per-account,
 * platform) against committed bytes PLUS every other currently-active
 * reservation, then — only if all pass — mint this upload's opaque object
 * key and reserve its bytes, all in one transaction. A single, fixed
 * transaction-scoped advisory lock serializes concurrent reservation
 * attempts platform-wide (pilot-scale volume makes this a negligible cost;
 * see the doc comment on the lock line for why this specific guarantee
 * isn't exercised by a Promise.all race test the way other fixes in this
 * PR are). Never silently exceeded, including under concurrent uploads.
 */
export async function reserveUpload(
  db: Db,
  input: ReserveUploadInput,
  config: UploadQuotaConfig = loadUploadQuotaConfig(),
): Promise<Result<UploadIntent, ServiceError>> {
  if (input.sizeBytes > config.maxUploadBytes) {
    return err(
      serviceError('invalid', `file exceeds the ${mbLabel(config.maxUploadBytes)} upload limit`),
    );
  }

  // Counts reservation attempts, not finished uploads: an attacker (or a
  // runaway client) hammering this is exactly what the byte quotas below do
  // not stop, since a rejected or abandoned reservation stores nothing. Runs
  // outside the transaction on purpose, so a refused attempt never takes the
  // platform-wide advisory lock that serializes every real reservation.
  const rateLimit = await checkRateLimit(
    db,
    { subjectId: input.accountId, action: 'upload.reserve', label: 'upload' },
    RATE_LIMITS.UPLOAD_RESERVE,
  );
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  return db.transaction(async (tx) => {
    // Fixed, well-known key: serializes ALL upload reservations platform-wide
    // (not just same-applicant/account ones), so the platform-wide hard-stop
    // check below is race-free too, not only the per-applicant/account ones.
    // PGlite fully serializes db.transaction() calls (confirmed by direct
    // experiment — see packages/services/src/ai.ts's identical note), so
    // this lock's differential effect cannot be exercised as a genuine
    // concurrent-request race in this test suite; its correctness rests on
    // Postgres's documented pg_advisory_xact_lock semantics instead. What
    // *is* tested here (uploads.test.ts) is that an already-committed
    // reservation is correctly counted by a later call, and that an expired
    // one is correctly excluded — the properties that actually make the
    // reservation model sound.
    await lockUploadQuota(tx);

    const quota = await checkQuotaTiers(tx, input, input.sizeBytes, config);
    if (!quota.ok) return err(quota.error);

    const intent = required(
      first(
        await tx
          .insert(schema.uploadIntents)
          .values({
            accountId: input.accountId,
            applicantId: input.applicantId,
            objectKey: randomUUID(),
            reservedBytes: input.sizeBytes,
            expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
          })
          .returning(),
      ),
      'upload intent',
    );
    return ok(intent);
  });
}

export interface GrowUploadReservationInput {
  readonly intentId: string;
  /** The size the reservation must now cover, in bytes. */
  readonly sizeBytes: number;
}

/**
 * Raise an upload's own reservation to cover a larger file than it was made for (UX-B: an iPhone
 * photo converted to a JPEG can be larger than the photo that was sent). One step, under the same
 * platform-wide lock and the same quota tiers as `reserveUpload`, counting only the extra bytes;
 * the reservation is never released in between, and it is not a new reservation attempt, so the
 * upload rate limit is not charged again. A reservation that already covers the size is returned
 * as it is. Only a reservation for the proof's applicant that is still active can grow.
 */
export async function growUploadReservation(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: GrowUploadReservationInput,
  config: UploadQuotaConfig = loadUploadQuotaConfig(),
): Promise<Result<UploadIntent, ServiceError>> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE')) {
    return err(serviceError('forbidden', 'not authorized'));
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
    return err(serviceError('invalid', 'the file size is not valid'));
  }
  if (input.sizeBytes > config.maxUploadBytes) {
    return err(
      serviceError('invalid', `file exceeds the ${mbLabel(config.maxUploadBytes)} upload limit`),
    );
  }
  return proof.tx.transaction(async (tx) => {
    await lockUploadQuota(tx);
    const intent = first(
      await tx
        .select()
        .from(schema.uploadIntents)
        .where(
          and(
            eq(schema.uploadIntents.id, input.intentId),
            eq(schema.uploadIntents.applicantId, proof.applicant.id),
            eq(schema.uploadIntents.status, 'RESERVED'),
            gt(schema.uploadIntents.expiresAt, sql`now()`),
          ),
        )
        .limit(1)
        .for('update'),
    );
    if (!intent) return err(serviceError('not_found', 'this upload is no longer in progress'));
    const addedBytes = input.sizeBytes - intent.reservedBytes;
    if (addedBytes <= 0) return ok(intent);

    const quota = await checkQuotaTiers(tx, intent, addedBytes, config);
    if (!quota.ok) return err(quota.error);

    const grown = required(
      first(
        await tx
          .update(schema.uploadIntents)
          .set({ reservedBytes: input.sizeBytes, updatedAt: new Date() })
          .where(eq(schema.uploadIntents.id, intent.id))
          .returning(),
      ),
      'upload intent',
    );
    return ok(grown);
  });
}

/** Reservation finalization: the upload completed and produced this document version. */
export async function finalizeUpload(
  db: Db,
  intentId: string,
  documentVersionId: string,
): Promise<void> {
  await db
    .update(schema.uploadIntents)
    .set({ status: 'COMPLETED', documentVersionId, updatedAt: new Date() })
    .where(eq(schema.uploadIntents.id, intentId));
}

/** Release a reservation on failure — it immediately stops counting toward any quota. Never deletes the row (audit trail of failed attempts). */
export async function failUpload(db: Db, intentId: string, reason: string): Promise<void> {
  await db
    .update(schema.uploadIntents)
    .set({ status: 'FAILED', failureReason: reason.slice(0, 2000), updatedAt: new Date() })
    .where(eq(schema.uploadIntents.id, intentId));
}

/**
 * Grace period before an abandoned reservation is irreversibly cleaned up
 * (directive Part 3 §3: "Delete abandoned objects/reservations after 24
 * hours"). Deliberately a separate, much longer constant than
 * `RESERVATION_TTL_MS`, which only stops a reservation counting toward
 * quota: cleanup deletes bytes and is not the same decision as "stop
 * charging this against the applicant's limit."
 */
const ABANDONED_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

const DEFAULT_ABANDONED_SWEEP_LIMIT = 200;

export interface AbandonedUploadSweepResult {
  readonly checked: number;
  readonly cleaned: number;
}

/**
 * Sweeps `uploadIntents` rows still `RESERVED` well past their TTL:
 * `reserveUpload`'s own request always ends in `finalizeUpload`/`failUpload`
 * except when the request itself was killed partway through (a serverless
 * timeout, OOM, or container recycle between the blob write and the
 * following steps), which no in-request try/catch can cover (see
 * `apps/web/.../actions.ts`'s own doc comment on why its try/catch is
 * deliberately scoped to stop before that point). Best-effort deletes any
 * bytes already written under the intent's own opaque `objectKey`, never
 * assumed to exist since the crash may have happened before the write ever
 * ran, then marks the intent `FAILED` with a compare-and-set so a
 * reservation that legitimately completed or failed between this sweep's
 * read and write is never stomped. Matches `failUpload`'s own shape: never
 * deletes the row itself (audit trail of abandoned attempts).
 *
 * Distinct from `reconciliation.ts`'s admin-triggered, report-only orphan
 * sweep: this targets one specific, well-understood failure shape (a
 * reservation whose own object key is known with certainty, not inferred
 * from "bytes with no metadata row" across the whole bucket) and is safe to
 * run unattended on a schedule, deleting bytes automatically rather than
 * only reporting them.
 *
 * `observability`, when provided, records one `abandoned_upload_cleaned`
 * event per sweep call that actually cleaned anything (directive Part 3
 * §13's "abandoned uploads" monitoring signal): a summary count, not one
 * event per row, so a large backlog does not itself flood the log.
 */
export async function sweepAbandonedUploads(
  db: Db,
  blobStore: BlobStore,
  limit = DEFAULT_ABANDONED_SWEEP_LIMIT,
  observability?: ObservabilityPort,
): Promise<AbandonedUploadSweepResult> {
  const cutoff = new Date(Date.now() - ABANDONED_CLEANUP_AGE_MS);
  const stale = await db
    .select()
    .from(schema.uploadIntents)
    .where(
      and(eq(schema.uploadIntents.status, 'RESERVED'), lt(schema.uploadIntents.expiresAt, cutoff)),
    )
    .limit(limit);

  let cleaned = 0;
  for (const intent of stale) {
    await blobStore.deleteObject('QUARANTINE', intent.objectKey).catch(() => undefined);
    const updated = await db
      .update(schema.uploadIntents)
      .set({
        status: 'FAILED',
        failureReason: 'abandoned: no upload activity completed within 24 hours of reservation',
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.uploadIntents.id, intent.id), eq(schema.uploadIntents.status, 'RESERVED')),
      )
      .returning({ id: schema.uploadIntents.id });
    if (updated.length > 0) cleaned++;
  }
  if (cleaned > 0) {
    observability?.record({
      name: 'abandoned_upload_cleaned',
      severity: 'warning',
      metadata: { checked: stale.length, cleaned },
    });
  }
  return { checked: stale.length, cleaned };
}
