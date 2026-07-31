import { type Result, err, ok } from '@visastack/core';
import { and, eq } from 'drizzle-orm';
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
 */
export async function placeLegalHold(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly applicantId: string;
    readonly reason: string;
    readonly stepUpSatisfied: boolean;
  },
): Promise<Result<LegalHold, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'placing a legal hold requires reauthentication'));
  }
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
