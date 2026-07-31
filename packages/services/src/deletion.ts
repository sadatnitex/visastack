import { type Result, err, ok } from '@visastack/core';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import type { StorageObject } from './documents';
import { enqueueErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';

/**
 * Account deletion workflow (Build Spec §13; PRD §2 — erasure).
 *
 * Deletion is a two-step, reversible operation: a request opens a grace window
 * during which it can be cancelled; execution (after the window) irreversibly
 * removes the account's owned data. The audit trail is preserved and
 * anonymized (FK `set null`), and the request row survives as a tombstone.
 * Every transition is audited.
 */

export type DeletionRequest = typeof schema.accountDeletionRequests.$inferSelect;

const DEFAULT_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function pendingRequest(db: Db, accountId: string): Promise<DeletionRequest | undefined> {
  return first(
    await db
      .select()
      .from(schema.accountDeletionRequests)
      .where(
        and(
          eq(schema.accountDeletionRequests.accountId, accountId),
          eq(schema.accountDeletionRequests.status, 'PENDING'),
        ),
      )
      .limit(1),
  );
}

/** The account's currently pending deletion request, if any (read-only). */
export async function getPendingDeletion(
  db: Db,
  accountId: string,
): Promise<DeletionRequest | undefined> {
  return pendingRequest(db, accountId);
}

/** PENDING requests whose grace window has elapsed — ready for `executeAccountDeletion`. */
export async function listDueDeletions(db: Db, now: Date = new Date()): Promise<DeletionRequest[]> {
  return db
    .select()
    .from(schema.accountDeletionRequests)
    .where(
      and(
        eq(schema.accountDeletionRequests.status, 'PENDING'),
        lte(schema.accountDeletionRequests.scheduledFor, now),
      ),
    );
}

/** Open a reversible deletion request for the actor's own account. */
export async function requestAccountDeletion(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly accountId: string;
    readonly reason?: string;
    readonly gracePeriodMs?: number;
    readonly now?: Date;
  },
): Promise<Result<DeletionRequest, ServiceError>> {
  if (input.actorAccountId !== input.accountId) {
    return err(serviceError('forbidden', 'an account may only request its own deletion'));
  }
  if (await pendingRequest(db, input.accountId)) {
    return err(serviceError('invalid', 'a deletion request is already pending'));
  }
  const now = input.now ?? new Date();
  const scheduledFor = new Date(now.getTime() + (input.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS));

  return db.transaction(async (tx) => {
    const request = required(
      first(
        await tx
          .insert(schema.accountDeletionRequests)
          .values({
            accountId: input.accountId,
            scheduledFor,
            reason: input.reason ?? null,
          })
          .returning(),
      ),
      'deletion request',
    );
    await appendAuditEvent(tx, {
      eventType: 'ACCOUNT_DELETION_REQUESTED',
      actorAccountId: input.accountId,
      method: 'API',
      result: 'ALLOWED',
      resourceType: 'account',
      resourceId: input.accountId,
      metadata: { scheduledFor: scheduledFor.toISOString() },
    });
    return ok(request);
  });
}

/** Cancel a pending deletion request during the grace window. */
export async function cancelAccountDeletion(
  db: Db,
  input: { readonly actorAccountId: string; readonly accountId: string },
): Promise<Result<DeletionRequest, ServiceError>> {
  if (input.actorAccountId !== input.accountId) {
    return err(serviceError('forbidden', 'an account may only cancel its own deletion'));
  }
  const pending = await pendingRequest(db, input.accountId);
  if (!pending) return err(serviceError('not_found', 'no pending deletion request'));

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.accountDeletionRequests)
          .set({ status: 'CANCELLED', cancelledAt: new Date() })
          .where(eq(schema.accountDeletionRequests.id, pending.id))
          .returning(),
      ),
      'deletion request',
    );
    await appendAuditEvent(tx, {
      eventType: 'ACCOUNT_DELETION_CANCELLED',
      actorAccountId: input.accountId,
      method: 'API',
      result: 'ALLOWED',
      resourceType: 'account',
      resourceId: input.accountId,
    });
    return ok(updated);
  });
}

/**
 * Execute a due deletion (grace window elapsed). Irreversibly removes the
 * account's owned applicants (cascading to their missions, grants, documents,
 * versions, and facts) and the account itself; queues the now-orphaned
 * storage objects for external-byte erasure (erasure.ts) rather than
 * deleting them here — never report "deleted" before that's verified. System
 * operation — runs after the window, not on user request.
 */
export async function executeAccountDeletion(
  db: Db,
  input: { readonly accountId: string; readonly now?: Date },
): Promise<Result<DeletionRequest, ServiceError>> {
  const pending = await pendingRequest(db, input.accountId);
  if (!pending) return err(serviceError('not_found', 'no pending deletion request'));
  const now = input.now ?? new Date();
  if (now.getTime() < pending.scheduledFor.getTime()) {
    return err(serviceError('invalid', 'grace window has not elapsed'));
  }

  return db.transaction(async (tx) => {
    const applicantRows = await tx
      .select({ id: schema.applicants.id })
      .from(schema.applicants)
      .where(eq(schema.applicants.ownerAccountId, input.accountId));
    const applicantIds = applicantRows.map((a) => a.id);

    // Legal hold overrides deletion (Build Spec §13): an active hold on ANY of
    // the account's applicants blocks erasure until the hold is released.
    // Rechecked here, inside the transaction that would otherwise cascade the
    // applicants away, so a hold placed after an earlier pre-check (and before
    // this transaction started) can never be raced past.
    if (applicantIds.length > 0) {
      const held = first(
        await tx
          .select({ id: schema.legalHolds.id })
          .from(schema.legalHolds)
          .where(
            and(
              inArray(schema.legalHolds.applicantId, applicantIds),
              eq(schema.legalHolds.active, true),
            ),
          )
          .limit(1),
      );
      if (held) return err(serviceError('invalid', 'an active legal hold blocks deletion'));
    }

    // Collect the storage objects this account's documents reference, before
    // the cascade below deletes the versions that point at them, and queue
    // each for external-byte erasure (erasure.ts — the only thing that ever
    // deletes real bytes; this transaction only ever removes DB rows).
    let storageObjects: StorageObject[] = [];
    if (applicantIds.length > 0) {
      const docs = await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(inArray(schema.documents.applicantId, applicantIds));
      const documentIds = docs.map((d) => d.id);
      if (documentIds.length > 0) {
        const objs = await tx
          .select({ storageObjectId: schema.documentVersions.storageObjectId })
          .from(schema.documentVersions)
          .where(inArray(schema.documentVersions.documentId, documentIds));
        const storageObjectIds = [...new Set(objs.map((o) => o.storageObjectId))];
        if (storageObjectIds.length > 0) {
          storageObjects = await tx
            .select()
            .from(schema.storageObjects)
            .where(inArray(schema.storageObjects.id, storageObjectIds));
        }
      }
      // Deleting applicants cascades to missions, grants, documents, versions,
      // facts. `storageObjects` is left untouched here — the `restrict` FK on
      // documentVersions.storageObjectId is already satisfied once those
      // versions are gone, and erasure.ts owns removing the row once the
      // external bytes are verified deleted.
      await tx.delete(schema.applicants).where(inArray(schema.applicants.id, applicantIds));
    }
    for (const object of storageObjects) {
      await enqueueErasureJob(tx, {
        reason: 'ACCOUNT_DELETION',
        bucket: object.bucket,
        objectKey: object.objectKey,
        expectedHash: object.contentHash,
        storageObjectId: object.id,
      });
    }

    // Rate-limit buckets are keyed directly by accountId (rate-limit.ts) and
    // outlive nothing else about the account by design — remove them too.
    await tx
      .delete(schema.rateLimitBuckets)
      .where(eq(schema.rateLimitBuckets.subjectId, input.accountId));

    // Mission notes authored by this account are collaborative history that
    // can live on a mission this account never owned (an org member's note on
    // someone else's mission) — anonymize rather than delete, matching every
    // other actor/author reference in this schema (documents.uploaderAccountId,
    // factVersions.actorAccountId, etc. all `set null` on deletion; this
    // column has no FK to enforce it, so it's done explicitly here).
    await tx
      .update(schema.missionNotes)
      .set({ authorAccountId: null })
      .where(eq(schema.missionNotes.authorAccountId, input.accountId));

    // Mark the request executed before the account row disappears.
    const updated = required(
      first(
        await tx
          .update(schema.accountDeletionRequests)
          .set({ status: 'EXECUTED', executedAt: now })
          .where(eq(schema.accountDeletionRequests.id, pending.id))
          .returning(),
      ),
      'deletion request',
    );
    // Audit before deleting the account (its id must still satisfy the FK);
    // the account delete then set-nulls this event's actor reference.
    await appendAuditEvent(tx, {
      eventType: 'ACCOUNT_DELETION_EXECUTED',
      actorAccountId: input.accountId,
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'account',
      resourceId: input.accountId,
      metadata: { pendingErasureJobs: storageObjects.length },
    });
    // Removes the account; cascades memberships/consents/recipient-grants and
    // set-nulls audit/uploader/actor references.
    await tx.delete(schema.accounts).where(eq(schema.accounts.id, input.accountId));
    return ok(updated);
  });
}
