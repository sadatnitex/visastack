import { type Result, err, ok } from '@visastack/core';
import { eq, inArray } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { enqueueErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { documentBlockedByLegalHold } from './legal-hold';

/**
 * Retention (Build Spec §13; PRD §5) — how long a document type is kept
 * before it becomes eligible for purge. See legal-hold.ts for the hold
 * primitives this module consults; purge never touches a held applicant's
 * documents.
 */

export {
  type AccountLegalHold,
  type LegalHold,
  type LegalHoldReminderSweepResult,
  type LegalHoldScopeDescription,
  documentBlockedByLegalHold,
  hasActiveLegalHold,
  legalHoldReminderIntervalDays,
  listActiveLegalHolds,
  listActiveLegalHoldsForAccount,
  listLegalHolds,
  listLegalHoldsNeedingReview,
  missionBlockedByLegalHold,
  placeLegalHold,
  releaseLegalHold,
  sweepLegalHoldReviewReminders,
} from './legal-hold';

export type RetentionPolicy = typeof schema.retentionPolicies.$inferSelect;

/** Create or update the retention policy for a document type (upsert by docType). */
export async function setRetentionPolicy(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly docType: string;
    readonly retentionDays: number;
  },
): Promise<Result<RetentionPolicy, ServiceError>> {
  if (input.retentionDays <= 0)
    return err(serviceError('invalid', 'retentionDays must be positive'));
  return db.transaction(async (tx) => {
    const existing = first(
      await tx
        .select()
        .from(schema.retentionPolicies)
        .where(eq(schema.retentionPolicies.docType, input.docType))
        .limit(1),
    );
    const policy = existing
      ? required(
          first(
            await tx
              .update(schema.retentionPolicies)
              .set({ retentionDays: input.retentionDays, updatedAt: new Date() })
              .where(eq(schema.retentionPolicies.id, existing.id))
              .returning(),
          ),
          'retention policy',
        )
      : required(
          first(
            await tx
              .insert(schema.retentionPolicies)
              .values({ docType: input.docType, retentionDays: input.retentionDays })
              .returning(),
          ),
          'retention policy',
        );
    await appendAuditEvent(tx, {
      eventType: 'RETENTION_POLICY_SET',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'retention_policy',
      resourceId: policy.id,
      metadata: { docType: input.docType, retentionDays: input.retentionDays },
    });
    return ok(policy);
  });
}

export async function getRetentionPolicies(db: Db): Promise<RetentionPolicy[]> {
  return db.select().from(schema.retentionPolicies);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Documents eligible for purge: past their type's retention and not held. */
export async function documentsPastRetention(
  db: Db,
  now: Date = new Date(),
): Promise<Array<typeof schema.documents.$inferSelect>> {
  const policies = new Map(
    (await getRetentionPolicies(db)).map((p) => [p.docType, p.retentionDays]),
  );
  if (policies.size === 0) return [];
  const documents = await db.select().from(schema.documents);
  const heldApplicants = new Set(
    (await db.select().from(schema.legalHolds).where(eq(schema.legalHolds.active, true))).map(
      (h) => h.applicantId,
    ),
  );
  return documents.filter((doc) => {
    if (doc.docType === null) return false;
    const days = policies.get(doc.docType);
    if (days === undefined) return false;
    if (heldApplicants.has(doc.applicantId)) return false;
    return now.getTime() - doc.createdAt.getTime() > days * DAY_MS;
  });
}

export interface PurgeExpiredDocumentsResult {
  /** Documents whose bytes were queued for erasure (see erasure.ts) — not yet actually deleted. */
  readonly queuedForErasure: number;
  /** Documents that were purge-eligible a moment ago but are now held, rechecked at the last possible instant. */
  readonly blockedByHold: number;
}

/**
 * Queue every document past its retention policy (not under legal hold) for
 * erasure. Never deletes anything itself — enqueues one erasure job per
 * storage object and leaves the document/storage rows in place until
 * erasure.ts's worker verifies the external bytes are actually gone (master
 * directive §7 "PR 4": never report "deleted" before that verification).
 * Audited per document, inside the same transaction as its own recheck, so a
 * hold placed after `documentsPastRetention`'s read is never raced past.
 * Step-up gated as "retention execution" (master directive §7 "PR 5"):
 * `stepUpSatisfied` must be honestly derived from a genuine WorkOS
 * reauthentication — see `apps/web/src/lib/step-up.ts`.
 */
export async function purgeExpiredDocuments(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly now?: Date;
    readonly stepUpSatisfied: boolean;
  },
): Promise<Result<PurgeExpiredDocumentsResult, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'running retention purge requires reauthentication'),
    );
  }
  const expired = await documentsPastRetention(db, input.now ?? new Date());
  if (expired.length === 0) return ok({ queuedForErasure: 0, blockedByHold: 0 });

  let queuedForErasure = 0;
  let blockedByHold = 0;
  for (const document of expired) {
    await db.transaction(async (tx) => {
      const held = await documentBlockedByLegalHold(tx, {
        applicantId: document.applicantId,
        documentId: document.id,
      });
      if (held) {
        blockedByHold++;
        return;
      }
      // Lock the document row (Codex review, PR-B2, round 1): `addDocumentVersion`
      // and `finalizeVerifiedJob` take the identical lock on the identical
      // row before, respectively, refusing new versions on a document with
      // an in-progress purge and deciding whether every version has
      // verified. Without it, a version attached in the gap between this
      // read and the enqueue loop below would silently miss this batch,
      // reach `finalizeVerifiedJob` with no erasure job of its own, and be
      // cascaded away with its bytes permanently unreachable once the
      // versions that WERE enqueued here all verify.
      await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, document.id))
        .for('update');
      const versions = await tx
        .select({ storageObjectId: schema.documentVersions.storageObjectId })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, document.id));
      const storageObjectIds = [...new Set(versions.map((v) => v.storageObjectId))];
      if (storageObjectIds.length === 0) return;

      const objects = await tx
        .select()
        .from(schema.storageObjects)
        .where(inArray(schema.storageObjects.id, storageObjectIds));
      for (const object of objects) {
        await enqueueErasureJob(tx, {
          reason: 'RETENTION_PURGE',
          bucket: object.bucket,
          objectKey: object.objectKey,
          expectedHash: object.contentHash,
          storageObjectId: object.id,
          documentId: document.id,
          applicantId: document.applicantId,
        });
      }
      queuedForErasure++;
      await appendAuditEvent(tx, {
        eventType: 'RETENTION_PURGE_QUEUED',
        actorAccountId: input.actorAccountId,
        method: 'SYSTEM',
        result: 'ALLOWED',
        applicantId: document.applicantId,
        resourceType: 'document',
        resourceId: document.id,
      });
    });
  }
  return ok({ queuedForErasure, blockedByHold });
}
