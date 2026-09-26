import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Legal holds (Build Spec §13; PRD §5).
 *
 * A legal hold on an applicant blocks erasure while active — it overrides
 * both account deletion (deletion.ts) and retention purge (retention.ts).
 * Split into its own module (rather than living in retention.ts, where this
 * started) because the erasure outbox (erasure.ts) also needs to recheck a
 * hold at claim time, and retention.ts now enqueues into that same outbox —
 * a shared, hold-agnostic leaf module avoids a retention.ts <-> erasure.ts
 * import cycle.
 */

export type LegalHold = typeof schema.legalHolds.$inferSelect;

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

/**
 * Place a legal hold on an applicant (privileged/compliance action).
 * Step-up gated (master directive §7 "PR 5"): `stepUpSatisfied` must be
 * honestly derived from a genuine WorkOS reauthentication — see
 * `apps/web/src/lib/step-up.ts`.
 *
 * Locks the applicant row (finding #14, post-programme defect register)
 * before inserting — `executeAccountDeletion` and `finalizeVerifiedJob`'s own
 * hold recheck take the identical lock on the identical key before their own
 * hold-sensitive work, so this placement and a concurrent destructive
 * operation on the same applicant can never interleave un-serialized. The
 * existence check now lives inside the same transaction as the lock (moved
 * from a separate, unlocked pre-check): checking outside the lock would
 * leave the exact gap this fix closes — the applicant could be deleted
 * between an outside check and this insert.
 *
 * `reviewAt` is required (directive Part 7 §13: a hold "needs...
 * review/expiry" and "cannot become indefinite convenience") and must be in
 * the future -- a hold placed with a review date already past would be
 * exactly the "indefinite convenience" the directive rules out. It is not
 * an auto-expiry: reaching it never releases the hold on its own, it only
 * makes the hold appear in `listLegalHoldsNeedingReview` so a compliance
 * admin has to look at it again, not forget it.
 */
export async function placeLegalHold(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly applicantId: string;
    readonly reason: string;
    readonly reviewAt: Date;
    readonly stepUpSatisfied: boolean;
  },
): Promise<Result<LegalHold, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'placing a legal hold requires reauthentication'));
  }
  if (input.reason.trim().length === 0) return err(serviceError('invalid', 'a reason is required'));
  if (input.reviewAt.getTime() <= Date.now()) {
    return err(serviceError('invalid', 'the review date must be in the future'));
  }

  return db.transaction(async (tx) => {
    const applicant = first(
      await tx
        .select()
        .from(schema.applicants)
        .where(eq(schema.applicants.id, input.applicantId))
        .limit(1)
        .for('update'),
    );
    if (!applicant) return err(serviceError('not_found', 'applicant not found'));

    const hold = required(
      first(
        await tx
          .insert(schema.legalHolds)
          .values({
            applicantId: input.applicantId,
            reason: input.reason.trim(),
            placedByAccountId: input.actorAccountId,
            reviewAt: input.reviewAt,
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

/**
 * Release a legal hold (privileged/compliance action). Step-up gated — see
 * `placeLegalHold`.
 */
export async function releaseLegalHold(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly holdId: string;
    readonly stepUpSatisfied: boolean;
  },
): Promise<Result<LegalHold, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'releasing a legal hold requires reauthentication'),
    );
  }
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

/**
 * Active holds needing a compliance admin's attention (directive Part 7
 * §13: "cannot become indefinite convenience") -- either past their own
 * review date, or (a hold placed before `reviewAt` existed) never given one
 * at all. A missing review date is treated as needing attention just as
 * much as a passed one, never silently excluded: `reviewAt IS NULL` would
 * otherwise never satisfy a plain `reviewAt < now()` comparison and could
 * sit unreviewed forever, exactly the outcome this exists to prevent.
 */
export async function listLegalHoldsNeedingReview(
  db: Db,
  now: Date = new Date(),
): Promise<LegalHold[]> {
  const rows = await db
    .select()
    .from(schema.legalHolds)
    .where(
      and(
        eq(schema.legalHolds.active, true),
        or(isNull(schema.legalHolds.reviewAt), lt(schema.legalHolds.reviewAt, now)),
      ),
    );
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export interface AccountLegalHold {
  readonly id: string;
  readonly applicantId: string;
  readonly applicantDisplayName: string;
  readonly reason: string;
  readonly placedAt: Date;
  readonly reviewAt: Date | null;
}

/**
 * Every currently active legal hold across any applicant this account owns
 * (PRV-03, master directive Part 7 §12 step 4: "show retained exceptions").
 * The one place both `requestAccountDeletion`'s own pre-check and the
 * privacy page's user-facing detail read from, so the enforcement and the
 * explanation can never drift apart -- an account can own more than one
 * applicant (self plus family members), so this is deliberately account-
 * wide, not the single-applicant `hasActiveLegalHold`/`listLegalHolds` above.
 */
export async function listActiveLegalHoldsForAccount(
  db: Db,
  accountId: string,
): Promise<readonly AccountLegalHold[]> {
  return db
    .select({
      id: schema.legalHolds.id,
      applicantId: schema.legalHolds.applicantId,
      applicantDisplayName: schema.applicants.displayName,
      reason: schema.legalHolds.reason,
      placedAt: schema.legalHolds.createdAt,
      reviewAt: schema.legalHolds.reviewAt,
    })
    .from(schema.legalHolds)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.legalHolds.applicantId))
    .where(
      and(eq(schema.applicants.ownerAccountId, accountId), eq(schema.legalHolds.active, true)),
    );
}
