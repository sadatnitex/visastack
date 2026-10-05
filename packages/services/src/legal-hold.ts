import { type Result, err, ok } from '@visastack/core';
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { missionsSelectingDocument } from './material-revision';
import { enqueueNotificationBothChannels } from './notifications';
import { listActivePlatformRoles } from './platform-roles';
import { listAccessForApplicantDetailed } from './sharing';

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

/** Every active hold row on an applicant with no scope narrower than "applicant-wide" -- shared by both scope-aware predicates below. */
function applicantWideHoldCondition() {
  return and(isNull(schema.legalHolds.missionId), isNull(schema.legalHolds.documentId));
}

/**
 * True if a mission's own case-record is blocked from case-retention purge
 * (`case-retention.ts`'s `purgeMissionUnconditionally`) by a legal hold --
 * either applicant-wide, or scoped to this exact mission (directive Part 7
 * §13 "exact scope"). A document-scoped hold never blocks this: mission
 * case-purge deletes only the mission's own case-record rows (decisions,
 * notes, selected-evidence links, snapshots) and blanks its descriptive
 * fields -- it never touches a document's own bytes/content, so a
 * document's protection stays complete without also freezing every
 * mission that happens to reference it.
 */
export async function missionBlockedByLegalHold(
  db: Db,
  input: { readonly applicantId: string; readonly missionId: string },
): Promise<boolean> {
  const row = first(
    await db
      .select({ id: schema.legalHolds.id })
      .from(schema.legalHolds)
      .where(
        and(
          eq(schema.legalHolds.applicantId, input.applicantId),
          eq(schema.legalHolds.active, true),
          or(applicantWideHoldCondition(), eq(schema.legalHolds.missionId, input.missionId)),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/**
 * True if a document is blocked from retention/erasure by a legal hold --
 * applicant-wide, scoped to this exact document, or scoped to any mission
 * that currently selects this document as evidence (directive Part 7 §13
 * "exact scope"). That last case is deliberate, not an over-reach: a
 * mission-scoped hold's own case-purge never touches document bytes (see
 * `missionBlockedByLegalHold`), but document retention runs on its own
 * independent, doc-type-keyed clock -- without this, the exact evidence a
 * held case is built on could still silently expire out from under it.
 */
export async function documentBlockedByLegalHold(
  db: Db,
  input: { readonly applicantId: string; readonly documentId: string },
): Promise<boolean> {
  const holdingMissionIds = await missionsSelectingDocument(db, input.documentId);
  const scopeConditions = [
    applicantWideHoldCondition(),
    eq(schema.legalHolds.documentId, input.documentId),
    ...(holdingMissionIds.length > 0
      ? [inArray(schema.legalHolds.missionId, holdingMissionIds)]
      : []),
  ];
  const row = first(
    await db
      .select({ id: schema.legalHolds.id })
      .from(schema.legalHolds)
      .where(
        and(
          eq(schema.legalHolds.applicantId, input.applicantId),
          eq(schema.legalHolds.active, true),
          or(...scopeConditions),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
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
 *
 * `missionId`/`documentId` (directive Part 7 §13: a hold "needs... exact
 * scope") are optional and mutually exclusive. Omitting both places an
 * applicant-wide hold -- unchanged from every hold placed before this
 * option existed. Given one, the hold narrows to exactly that mission's own
 * case-purge (`missionBlockedByLegalHold`) or that document's own
 * retention/erasure (`documentBlockedByLegalHold`) -- see those functions'
 * own doc comments for why a mission-scoped hold also reaches the evidence
 * currently selected for it, while a document-scoped hold does not reach
 * back into any mission.
 */
export async function placeLegalHold(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly applicantId: string;
    readonly reason: string;
    readonly reviewAt: Date;
    readonly stepUpSatisfied: boolean;
    readonly missionId?: string;
    readonly documentId?: string;
  },
): Promise<Result<LegalHold, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'placing a legal hold requires reauthentication'));
  }
  if (input.reason.trim().length === 0) return err(serviceError('invalid', 'a reason is required'));
  if (input.reviewAt.getTime() <= Date.now()) {
    return err(serviceError('invalid', 'the review date must be in the future'));
  }
  if (input.missionId && input.documentId) {
    return err(serviceError('invalid', 'a hold can be scoped to a case or a document, not both'));
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

    if (input.missionId) {
      const mission = first(
        await tx
          .select({ applicantId: schema.missions.applicantId })
          .from(schema.missions)
          .where(eq(schema.missions.id, input.missionId))
          .limit(1),
      );
      if (!mission) return err(serviceError('not_found', 'case not found'));
      if (mission.applicantId !== input.applicantId) {
        return err(serviceError('invalid', 'that case does not belong to this applicant'));
      }
    }
    if (input.documentId) {
      const document = first(
        await tx
          .select({ applicantId: schema.documents.applicantId })
          .from(schema.documents)
          .where(eq(schema.documents.id, input.documentId))
          .limit(1),
      );
      if (!document) return err(serviceError('not_found', 'document not found'));
      if (document.applicantId !== input.applicantId) {
        return err(serviceError('invalid', 'that document does not belong to this applicant'));
      }
    }

    const hold = required(
      first(
        await tx
          .insert(schema.legalHolds)
          .values({
            applicantId: input.applicantId,
            missionId: input.missionId ?? null,
            documentId: input.documentId ?? null,
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

/** Directive Part 7 §13: "Hold needs... exact scope" -- what the hold actually reaches, in terms a traveller can read. */
export type LegalHoldScopeDescription =
  | { readonly kind: 'applicant' }
  | { readonly kind: 'mission'; readonly missionId: string; readonly missionTitle: string }
  | { readonly kind: 'document'; readonly documentId: string; readonly documentName: string };

export interface AccountLegalHold {
  readonly id: string;
  readonly applicantId: string;
  readonly applicantDisplayName: string;
  readonly reason: string;
  readonly placedAt: Date;
  readonly reviewAt: Date | null;
  /** Directive Part 7 §13: "when retained, explain... who can access." Every account/organization with a genuinely current (ACTIVE, unexpired) grant on this applicant -- never a paused, revoked, or expired one, which no longer means real access. */
  readonly accessibleTo: readonly string[];
  readonly scope: LegalHoldScopeDescription;
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
  const rows = await db
    .select({
      id: schema.legalHolds.id,
      applicantId: schema.legalHolds.applicantId,
      applicantDisplayName: schema.applicants.displayName,
      reason: schema.legalHolds.reason,
      placedAt: schema.legalHolds.createdAt,
      reviewAt: schema.legalHolds.reviewAt,
      missionId: schema.legalHolds.missionId,
      missionTitle: schema.missions.title,
      documentId: schema.legalHolds.documentId,
      documentName: schema.documents.originalName,
    })
    .from(schema.legalHolds)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.legalHolds.applicantId))
    .leftJoin(schema.missions, eq(schema.missions.id, schema.legalHolds.missionId))
    .leftJoin(schema.documents, eq(schema.documents.id, schema.legalHolds.documentId))
    .where(
      and(eq(schema.applicants.ownerAccountId, accountId), eq(schema.legalHolds.active, true)),
    );

  const now = Date.now();
  return Promise.all(
    rows.map(async (row) => {
      // Reuses the exact grant-listing/recipient-resolution logic
      // `sharing.ts`'s own owner-facing access view already uses -- never a
      // second, independently-maintained "who has access" query that could
      // drift from it. The ownership check inside is a genuine no-op here
      // (this query's own join already proved `accountId` owns `applicantId`),
      // not a redundant authorization gap.
      const access = await listAccessForApplicantDetailed(db, accountId, row.applicantId);
      const accessibleTo = access.ok
        ? access.value
            .filter(
              (grant) =>
                grant.status === 'ACTIVE' &&
                (grant.expiryAt === null || grant.expiryAt.getTime() > now),
            )
            .map((grant) => grant.recipient.label)
        : [];
      const scope: LegalHoldScopeDescription = row.missionId
        ? { kind: 'mission', missionId: row.missionId, missionTitle: row.missionTitle ?? 'a case' }
        : row.documentId
          ? {
              kind: 'document',
              documentId: row.documentId,
              documentName: row.documentName ?? 'a document',
            }
          : { kind: 'applicant' };
      return {
        id: row.id,
        applicantId: row.applicantId,
        applicantDisplayName: row.applicantDisplayName,
        reason: row.reason,
        placedAt: row.placedAt,
        reviewAt: row.reviewAt,
        accessibleTo,
        scope,
      };
    }),
  );
}

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

const DEFAULT_REMINDER_INTERVAL_DAYS = 7;

/** How often an already-overdue hold gets re-reminded. Env-overridable like every other numeric default in this codebase. */
export function legalHoldReminderIntervalDays(): number {
  const raw = readEnv('LEGAL_HOLD_REMINDER_INTERVAL_DAYS');
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REMINDER_INTERVAL_DAYS;
}

export interface LegalHoldReminderSweepResult {
  readonly checked: number;
  readonly notified: number;
}

/**
 * Pushes a real reminder to every current COMPLIANCE_ADMIN once a hold
 * becomes due for review (directive Part 7 §13: "any scheduled reminder
 * when a hold becomes due" -- today, before this, it was discoverable via
 * `listLegalHoldsNeedingReview` and the admin page's own badge, but never
 * pushed). Deliberately NOT a one-time notice like `sweepCaseRetentionNotices`:
 * a hold review left ignored is still the exact "indefinite convenience"
 * directive §13 rules out, so this re-notifies every
 * `legalHoldReminderIntervalDays()` for as long as the hold stays overdue,
 * rather than firing once and going silent if that one message is missed.
 * Every current COMPLIANCE_ADMIN is notified, not just the account that
 * originally placed the hold -- compliance is a shared platform
 * responsibility, and the original placer may no longer even hold the role.
 */
export async function sweepLegalHoldReviewReminders(
  db: Db,
  limit = 50,
): Promise<LegalHoldReminderSweepResult> {
  const intervalMs = legalHoldReminderIntervalDays() * 24 * 60 * 60 * 1000;
  const now = new Date();

  const needingReview = await listLegalHoldsNeedingReview(db, now);
  const due = needingReview
    .filter(
      (hold) =>
        !hold.lastReviewReminderAt ||
        now.getTime() - hold.lastReviewReminderAt.getTime() >= intervalMs,
    )
    .slice(0, limit);
  if (due.length === 0) return { checked: needingReview.length, notified: 0 };

  const complianceAdmins = (await listActivePlatformRoles(db)).filter(
    (grant) => grant.role === 'COMPLIANCE_ADMIN' && grant.accountId,
  );

  let notified = 0;
  for (const hold of due) {
    const sent = await db.transaction(async (tx) => {
      // CAS against the exact value read above -- a safe no-op if a
      // concurrent sweep already claimed this hold's reminder, same
      // discipline every other sweep/worker in this codebase uses.
      const updated = first(
        await tx
          .update(schema.legalHolds)
          .set({ lastReviewReminderAt: now })
          .where(
            and(
              eq(schema.legalHolds.id, hold.id),
              hold.lastReviewReminderAt
                ? eq(schema.legalHolds.lastReviewReminderAt, hold.lastReviewReminderAt)
                : isNull(schema.legalHolds.lastReviewReminderAt),
            ),
          )
          .returning({ id: schema.legalHolds.id }),
      );
      if (!updated) return false;

      const applicant = first(
        await tx
          .select({ displayName: schema.applicants.displayName })
          .from(schema.applicants)
          .where(eq(schema.applicants.id, hold.applicantId))
          .limit(1),
      );
      for (const admin of complianceAdmins) {
        if (!admin.accountId) continue;
        await enqueueNotificationBothChannels(tx, {
          eventType: 'LEGAL_HOLD_REVIEW_REMINDER',
          resourceId: hold.id,
          recipientAccountId: admin.accountId,
          applicantId: hold.applicantId,
          payload: {
            subject: 'Legal hold review overdue',
            summary: hold.reviewAt
              ? `The hold on ${applicant?.displayName ?? 'an applicant'} (reason: ${hold.reason}) was due for review on ${hold.reviewAt.toLocaleDateString()}.`
              : `The hold on ${applicant?.displayName ?? 'an applicant'} (reason: ${hold.reason}) has never had a review date set.`,
            deepLinkPath: '/app/admin',
          },
        });
      }
      return true;
    });
    if (sent) notified++;
  }
  return { checked: needingReview.length, notified };
}
