import { type Result, err, ok } from '@visastack/core';
import { and, eq, inArray } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
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
 * versions, and facts), the now-unreferenced storage objects, and the account
 * itself. System operation — runs after the window, not on user request.
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

  // Legal hold overrides deletion (Build Spec §13): an active hold on ANY of the
  // account's applicants blocks erasure until the hold is released.
  const ownedApplicantIds = (
    await db
      .select({ id: schema.applicants.id })
      .from(schema.applicants)
      .where(eq(schema.applicants.ownerAccountId, input.accountId))
  ).map((a) => a.id);
  if (ownedApplicantIds.length > 0) {
    const held = first(
      await db
        .select({ id: schema.legalHolds.id })
        .from(schema.legalHolds)
        .where(
          and(
            inArray(schema.legalHolds.applicantId, ownedApplicantIds),
            eq(schema.legalHolds.active, true),
          ),
        )
        .limit(1),
    );
    if (held) return err(serviceError('invalid', 'an active legal hold blocks deletion'));
  }

  return db.transaction(async (tx) => {
    const applicantRows = await tx
      .select({ id: schema.applicants.id })
      .from(schema.applicants)
      .where(eq(schema.applicants.ownerAccountId, input.accountId));
    const applicantIds = applicantRows.map((a) => a.id);

    // Collect storage objects referenced by this account's documents so we can
    // remove the now-orphaned bytes after the cascade deletes the versions.
    let storageObjectIds: string[] = [];
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
        storageObjectIds = [...new Set(objs.map((o) => o.storageObjectId))];
      }
      // Deleting applicants cascades to missions, grants, documents, versions, facts.
      await tx.delete(schema.applicants).where(inArray(schema.applicants.id, applicantIds));
    }
    if (storageObjectIds.length > 0) {
      await tx
        .delete(schema.storageObjects)
        .where(inArray(schema.storageObjects.id, storageObjectIds));
    }

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
    });
    // Removes the account; cascades memberships/consents/recipient-grants and
    // set-nulls audit/uploader/actor references.
    await tx.delete(schema.accounts).where(eq(schema.accounts.id, input.accountId));
    return ok(updated);
  });
}
