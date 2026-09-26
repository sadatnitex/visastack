import { type ConsentType, type Result, err, ok } from '@visastack/core';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { getConsents } from './consent';
import { type Db, first, isUniqueViolation, required, schema } from './db';
import type { StorageObject } from './documents';
import { enqueueErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { listActiveLegalHoldsForAccount } from './legal-hold';

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

// PRV-03 (master directive Part 7 §12 step 6): "revoke/cancel optional
// processing" at REQUEST time, not only incidentally when the account row
// is finally removed after the grace window. CORE_PROCESSING is
// deliberately excluded -- it is not optional, and the account still needs
// to function (sign in, view this very page, cancel the request) throughout
// the grace window.
const OPTIONAL_PROCESSING_CONSENT_TYPES: readonly ConsentType[] = [
  'AI_EXTRACTION',
  'SHARING',
  'MARKETING',
  'ISSUER_CONTACT',
];

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
  // PRV-03 (Part 7 §12 step 4): fail fast and honestly, rather than letting
  // the requester wait out the full grace window only for
  // `executeAccountDeletion`'s own (still separately, correctly, and
  // necessarily re-checked) hold recheck to silently refuse at day 7. This
  // pre-check narrows the window; it does not replace that recheck, which
  // remains the actual point of enforcement against a hold placed after
  // this request is already pending.
  if ((await listActiveLegalHoldsForAccount(db, input.accountId)).length > 0) {
    return err(serviceError('invalid', 'an active legal hold blocks deletion'));
  }
  const now = input.now ?? new Date();
  const scheduledFor = new Date(now.getTime() + (input.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS));

  try {
    return await db.transaction(async (tx) => {
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

      // Revoke every currently-granted optional-processing consent now,
      // inline (not via consent.ts's own `setConsent`, which opens its own
      // transaction) so this commits atomically with the request itself.
      // Only a type that is actually granted gets a new row -- one already
      // off stays untouched, so this never manufactures a spurious "revoked"
      // entry in a consent history that never granted it in the first place.
      const currentConsents = await getConsents(tx, input.accountId);
      for (const type of OPTIONAL_PROCESSING_CONSENT_TYPES) {
        if (!currentConsents[type]) continue;
        await tx.insert(schema.consentRecords).values({
          accountId: input.accountId,
          type,
          grantedAt: null,
          revokedAt: now,
        });
        await appendAuditEvent(tx, {
          eventType: 'CONSENT_REVOKED',
          actorAccountId: input.accountId,
          method: 'SYSTEM',
          result: 'ALLOWED',
          resourceType: 'consent',
          resourceId: `${input.accountId}:${type}`,
          metadata: { type, granted: false, reason: 'account_deletion_requested' },
        });
      }

      return ok(request);
    });
  } catch (error) {
    // The pre-check above narrows the window but is two separate statements,
    // not one atomic operation, a true concurrent request can still pass it
    // before either commits. The partial unique index on (accountId) WHERE
    // status = 'PENDING' is the real backstop; this turns its violation into
    // the same clean error the pre-check already returns, matching
    // accounts.ts's established isUniqueViolation pattern, rather than an
    // unhandled 500.
    if (isUniqueViolation(error)) {
      return err(serviceError('invalid', 'a deletion request is already pending'));
    }
    throw error;
  }
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
    // `.for('update')` locks every one of this account's applicant rows for
    // the rest of this transaction (finding #14, post-programme defect
    // register). `placeLegalHold` and `finalizeVerifiedJob`'s own hold
    // recheck take the identical lock on the identical key before their own
    // hold-sensitive work — so a hold that commits anywhere in this window
    // can never be invisible to the read below, and a hold placement that
    // starts after this transaction has already locked an applicant row
    // correctly waits and then (once unblocked) finds that applicant gone.
    // Without this lock, a plain unlocked read here could miss a hold
    // committed in the gap, let deletion proceed, and (via
    // `legal_holds.applicant_id`'s cascade) destroy the very hold record
    // that should have stopped it.
    const applicantRows = await tx
      .select({ id: schema.applicants.id })
      .from(schema.applicants)
      .where(eq(schema.applicants.ownerAccountId, input.accountId))
      .orderBy(schema.applicants.id)
      .for('update');
    const applicantIds = applicantRows.map((a) => a.id);

    // Lock every one of these applicants' document rows too, EARLY — before
    // any `appendAuditEvent` call below (Codex review, PR-B2, round 2, P2):
    // `appendAuditEvent` takes a single global `pg_advisory_xact_lock`
    // (`AUDIT_CHAIN_LOCK_KEY`, audit.ts) for the rest of the transaction.
    // `purgeExpiredDocuments`, `finalizeVerifiedJob`, and `addDocumentVersion`
    // (finding #13's fix) each lock a `documents` row and only later call
    // `appendAuditEvent` — documents-lock-then-audit-lock. Before this fix,
    // this function's own order was the OPPOSITE: audit-lock (role
    // revocation, below) then, only much later, an implicit documents lock
    // via the applicant cascade — audit-lock-then-documents-lock. Two
    // transactions acquiring the same two resources in opposite orders is
    // exactly what deadlocks: this function could hold the audit lock
    // wanting a document another transaction holds while that transaction
    // holds the document wanting the audit lock, and Postgres would abort
    // one of them. Acquiring documents here, before any audit call, makes
    // every lock-taking path in this codebase agree on one order —
    // applicants, then documents, then audit — so no cycle is possible.
    if (applicantIds.length > 0) {
      await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(inArray(schema.documents.applicantId, applicantIds))
        .orderBy(schema.documents.id)
        .for('update');
    }

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

    // Deleting the sole active PLATFORM_OWNER would strand the platform
    // permanently: `platform_roles.account_id` is nullable + `set null`
    // (finding #17), so without this guard the FK would silently null it
    // while leaving the row "active" — `isPlatformOwner` can no longer match
    // it, yet the historical row keeps `totalGrantCount()` above zero,
    // permanently disabling the bootstrap fallback, and this deletion path
    // never calls `revokePlatformRole` so its own last-owner safeguard never
    // runs (Codex review, PR #65). Locks every PLATFORM_OWNER row so a
    // concurrent revoke/delete of a DIFFERENT owner serializes against this
    // one, mirroring `revokePlatformRole`'s own lock.
    const ownerGrants = await tx
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.role, 'PLATFORM_OWNER'))
      .for('update');
    const activeOwnerGrants = ownerGrants.filter((o) => o.revokedAt === null);
    const otherActiveOwners = activeOwnerGrants.filter((o) => o.accountId !== input.accountId);
    if (activeOwnerGrants.length > 0 && otherActiveOwners.length === 0) {
      return err(
        serviceError(
          'invalid',
          'cannot delete the sole platform owner — grant PLATFORM_OWNER to another account first',
        ),
      );
    }

    // Revoke (never silently orphan) this account's own active platform-role
    // grants, of any role, as part of this same transaction — deletion is a
    // legitimate revocation reason, and the historical row must say so
    // rather than be left with `revoked_at` still null once the FK nulls
    // `account_id` below.
    const revokedGrants = await tx
      .update(schema.platformRoles)
      .set({ revokedAt: now, revokedReason: 'account deleted' })
      .where(
        and(
          eq(schema.platformRoles.accountId, input.accountId),
          isNull(schema.platformRoles.revokedAt),
        ),
      )
      .returning();
    for (const grant of revokedGrants) {
      await appendAuditEvent(tx, {
        eventType: 'PLATFORM_ROLE_REVOKED',
        actorAccountId: input.accountId,
        action: 'MANAGE',
        method: 'SYSTEM',
        result: 'ALLOWED',
        resourceType: 'platform_role',
        resourceId: grant.id,
        reason: 'account deleted',
        metadata: { targetAccountId: grant.accountId, role: grant.role },
      });
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
