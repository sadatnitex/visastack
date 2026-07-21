import { type Result, err, ok } from '@visastack/core';
import { and, eq, inArray } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Retention & legal hold (Build Spec §13; PRD §5).
 *
 * A legal hold on an applicant blocks erasure while active — it overrides
 * deletion (see deletion.ts, which consults `hasActiveLegalHold`). Retention
 * policies define how long a document type is kept before it becomes eligible
 * for purge; purge never touches a held applicant's documents.
 */

export type LegalHold = typeof schema.legalHolds.$inferSelect;
export type RetentionPolicy = typeof schema.retentionPolicies.$inferSelect;

/** True if the applicant currently has any active legal hold. */
export async function hasActiveLegalHold(db: Db, applicantId: string): Promise<boolean> {
  const hold = first(
    await db
      .select()
      .from(schema.legalHolds)
      .where(
        and(eq(schema.legalHolds.applicantId, applicantId), eq(schema.legalHolds.active, true)),
      )
      .limit(1),
  );
  return hold !== undefined;
}

/** Place a legal hold on an applicant (privileged/compliance action). */
export async function placeLegalHold(
  db: Db,
  input: { readonly actorAccountId: string; readonly applicantId: string; readonly reason: string },
): Promise<Result<LegalHold, ServiceError>> {
  if (input.reason.trim().length === 0) return err(serviceError('invalid', 'a reason is required'));
  const applicant = first(
    await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, input.applicantId))
      .limit(1),
  );
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));

  return db.transaction(async (tx) => {
    const hold = required(
      first(
        await tx
          .insert(schema.legalHolds)
          .values({
            applicantId: input.applicantId,
            reason: input.reason.trim(),
            placedByAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'legal hold',
    );
    await appendAuditEvent(tx, {
      eventType: 'LEGAL_HOLD_PLACED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'legal_hold',
      resourceId: hold.id,
    });
    return ok(hold);
  });
}

/** Release a legal hold (privileged/compliance action). */
export async function releaseLegalHold(
  db: Db,
  input: { readonly actorAccountId: string; readonly holdId: string },
): Promise<Result<LegalHold, ServiceError>> {
  const hold = first(
    await db
      .select()
      .from(schema.legalHolds)
      .where(eq(schema.legalHolds.id, input.holdId))
      .limit(1),
  );
  if (!hold) return err(serviceError('not_found', 'legal hold not found'));
  if (!hold.active) return err(serviceError('invalid', 'legal hold is already released'));

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.legalHolds)
          .set({ active: false, releasedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.legalHolds.id, input.holdId))
          .returning(),
      ),
      'legal hold',
    );
    await appendAuditEvent(tx, {
      eventType: 'LEGAL_HOLD_RELEASED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: hold.applicantId,
      resourceType: 'legal_hold',
      resourceId: updated.id,
    });
    return ok(updated);
  });
}

export async function listLegalHolds(db: Db, applicantId: string): Promise<LegalHold[]> {
  return db.select().from(schema.legalHolds).where(eq(schema.legalHolds.applicantId, applicantId));
}

/** All currently active legal holds (platform-admin overview), newest first. */
export async function listActiveLegalHolds(db: Db): Promise<LegalHold[]> {
  const rows = await db.select().from(schema.legalHolds).where(eq(schema.legalHolds.active, true));
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

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

/** Purge documents past retention (not under legal hold). Audited. */
export async function purgeExpiredDocuments(
  db: Db,
  input: { readonly actorAccountId: string; readonly now?: Date },
): Promise<Result<{ readonly purged: number }, ServiceError>> {
  const expired = await documentsPastRetention(db, input.now ?? new Date());
  if (expired.length === 0) return ok({ purged: 0 });
  const documentIds = expired.map((d) => d.id);

  return db.transaction(async (tx) => {
    const versions = await tx
      .select({ storageObjectId: schema.documentVersions.storageObjectId })
      .from(schema.documentVersions)
      .where(inArray(schema.documentVersions.documentId, documentIds));
    const storageObjectIds = [...new Set(versions.map((v) => v.storageObjectId))];

    await tx.delete(schema.documents).where(inArray(schema.documents.id, documentIds));
    if (storageObjectIds.length > 0) {
      await tx
        .delete(schema.storageObjects)
        .where(inArray(schema.storageObjects.id, storageObjectIds));
    }
    await appendAuditEvent(tx, {
      eventType: 'RETENTION_PURGE',
      actorAccountId: input.actorAccountId,
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'document',
      resourceId: null,
      metadata: { purged: documentIds.length },
    });
    return ok({ purged: documentIds.length });
  });
}
