import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, gt, sql } from 'drizzle-orm';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  type UploadQuotaConfig,
  getAccountEvidenceBytes,
  getApplicantEvidenceBytes,
  getPlatformEvidenceBytes,
  loadUploadQuotaConfig,
  mbLabel,
} from './quotas';

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
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('visastack:upload-quota'))`);

    const applicantReserved = await activeReservedBytesFor(tx, 'applicantId', input.applicantId);
    const applicantCommitted = await getApplicantEvidenceBytes(tx, input.applicantId);
    if (
      applicantCommitted + applicantReserved + input.sizeBytes >
      config.maxApplicantEvidenceBytes
    ) {
      return err(
        serviceError(
          'invalid',
          `this applicant has reached its ${mbLabel(config.maxApplicantEvidenceBytes)} evidence limit`,
        ),
      );
    }

    const accountReserved = await activeReservedBytesFor(tx, 'accountId', input.accountId);
    const accountCommitted = await getAccountEvidenceBytes(tx, input.accountId);
    if (accountCommitted + accountReserved + input.sizeBytes > config.maxAccountEvidenceBytes) {
      return err(
        serviceError(
          'invalid',
          `this account has reached its ${mbLabel(config.maxAccountEvidenceBytes)} evidence limit`,
        ),
      );
    }

    const platformReserved = await activePlatformReservedBytes(tx);
    const platformCommitted = await getPlatformEvidenceBytes(tx);
    if (platformCommitted + platformReserved + input.sizeBytes > config.platformHardStopBytes) {
      return err(
        serviceError(
          'invalid',
          'platform storage capacity reached; new uploads are temporarily paused',
        ),
      );
    }

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
