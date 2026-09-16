import type { AccountId, ApplicantId, PermissionAction } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import type { Grant as PolicyGrant } from '@visastack/policy';
import { and, eq, isNull } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Support access grants (Commercial V1 SEC-06; PRD §14, §4 "Support
 * operator"). A scoped, time-limited, reasoned, approved grant of read
 * access to one applicant's protected content for a support operator —
 * distinct from `sharing.ts`'s `grants` table, which an applicant creates
 * for themselves. This one is created BY a platform operator ABOUT an
 * applicant who never consented to it, so it carries mandatory reason and
 * approver fields ordinary sharing grants don't need, and the database
 * itself enforces a maximum 60-minute duration and refuses a self-approved
 * grant (`support_grants_max_duration`/`support_grants_approver_not_actor`
 * check constraints, packages/db/src/schema.ts) — not just a service-layer
 * convention either could quietly drift from.
 *
 * `loadSupportGrantsForPolicy` converts an active row here into the same
 * `Grant` shape `packages/policy`'s `authorize()` already evaluates for a
 * `support_admin` actor (see `evaluateBase`'s `support_admin` case), reusing
 * its tested status/expiry/purpose/scope logic rather than duplicating it.
 */

export type SupportGrant = typeof schema.supportGrants.$inferSelect;

/** No support grant may outlive its creation by more than this (SEC-06). Enforced again at the database level. */
export const SUPPORT_GRANT_MAX_DURATION_MINUTES = 60;

/** The fixed purpose every support-access grant evaluates under (never user-supplied — this is what makes it identifiable as support access, not an ordinary share). */
export const SUPPORT_ACCESS_PURPOSE = 'support_access';

export interface CreateSupportGrantInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly actions: readonly PermissionAction[];
  readonly reason: string;
  readonly approvedByAccountId: string;
  readonly durationMinutes: number;
}

/**
 * Issue a time-limited support grant. `approvedByAccountId` must be a real,
 * distinct account from `actorAccountId` — this function does not itself
 * verify that account is authorized to approve (that is a platform-role
 * check the caller performs, mirroring how `createGrant` in sharing.ts
 * trusts its caller to have already verified applicant ownership); it does
 * enforce the structural rules a caller cannot get around: reason required,
 * duration within the 60-minute maximum, and — belt and suspenders with the
 * database check constraint — approver distinct from actor.
 */
export async function createSupportGrant(
  db: Db,
  input: CreateSupportGrantInput,
): Promise<Result<SupportGrant, ServiceError>> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    return err(serviceError('invalid', 'a reason is required for support access'));
  }
  if (input.approvedByAccountId === input.actorAccountId) {
    return err(serviceError('invalid', 'a support grant cannot be self-approved'));
  }
  if (
    !Number.isFinite(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    input.durationMinutes > SUPPORT_GRANT_MAX_DURATION_MINUTES
  ) {
    return err(
      serviceError(
        'invalid',
        `duration must be between 1 and ${SUPPORT_GRANT_MAX_DURATION_MINUTES} minutes`,
      ),
    );
  }
  if (input.actions.length === 0) {
    return err(serviceError('invalid', 'at least one action is required'));
  }
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));

  const startAt = new Date();
  const expiryAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);

  return db.transaction(async (tx) => {
    const grant = required(
      first(
        await tx
          .insert(schema.supportGrants)
          .values({
            actorAccountId: input.actorAccountId,
            applicantId: input.applicantId,
            actions: [...input.actions],
            reason,
            approvedByAccountId: input.approvedByAccountId,
            startAt,
            expiryAt,
          })
          .returning(),
      ),
      'support grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'SUPPORT_GRANT_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'support_grant',
      resourceId: grant.id,
      reason,
      grantId: grant.id,
      metadata: {
        approvedByAccountId: input.approvedByAccountId,
        durationMinutes: input.durationMinutes,
        actions: input.actions,
      },
    });
    return ok(grant);
  });
}

export interface RevokeSupportGrantInput {
  readonly grantId: string;
  readonly revokedByAccountId: string;
  readonly reason: string;
}

/** Revoke a support grant before its natural expiry. Idempotent: revoking an already-revoked grant is a no-op success, not an error. */
export async function revokeSupportGrant(
  db: Db,
  input: RevokeSupportGrantInput,
): Promise<Result<SupportGrant, ServiceError>> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    return err(serviceError('invalid', 'a reason is required to revoke a support grant'));
  }
  const existing = first(
    await db
      .select()
      .from(schema.supportGrants)
      .where(eq(schema.supportGrants.id, input.grantId))
      .limit(1),
  );
  if (!existing) return err(serviceError('not_found', 'support grant not found'));
  if (existing.revokedAt) return ok(existing);

  return db.transaction(async (tx) => {
    const revoked = required(
      first(
        await tx
          .update(schema.supportGrants)
          .set({
            revokedAt: new Date(),
            revokedByAccountId: input.revokedByAccountId,
            revokedReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(schema.supportGrants.id, input.grantId))
          .returning(),
      ),
      'support grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'SUPPORT_GRANT_REVOKED',
      actorAccountId: input.revokedByAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: revoked.applicantId,
      resourceType: 'support_grant',
      resourceId: revoked.id,
      reason,
      grantId: revoked.id,
    });
    return ok(revoked);
  });
}

/** Every support grant ever issued for an applicant, newest first — full history, including revoked/expired, for audit review. */
export async function listSupportGrantsForApplicant(
  db: Db,
  applicantId: string,
): Promise<SupportGrant[]> {
  const rows = await db
    .select()
    .from(schema.supportGrants)
    .where(eq(schema.supportGrants.applicantId, applicantId));
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Currently non-revoked support grants for an applicant (may still include ones whose `expiryAt` has passed; the policy engine is what actually enforces expiry at evaluation time). */
export async function listActiveSupportGrantsForApplicant(
  db: Db,
  applicantId: string,
): Promise<SupportGrant[]> {
  return db
    .select()
    .from(schema.supportGrants)
    .where(
      and(
        eq(schema.supportGrants.applicantId, applicantId),
        isNull(schema.supportGrants.revokedAt),
      ),
    );
}

/**
 * Map this applicant's non-revoked support grants into the policy engine's
 * `Grant` shape, for merging into `AuthContext.grants` when the acting actor
 * is `{ kind: 'support_admin' }`. Reuses `authorize()`'s own tested
 * expiry/status/purpose evaluation rather than re-implementing it — a
 * support grant is authorized (or not) by exactly the same code path as any
 * other grant, once converted to this shape.
 */
export async function loadSupportGrantsForPolicy(
  db: Db,
  applicantId: string,
): Promise<PolicyGrant[]> {
  const rows = await listActiveSupportGrantsForApplicant(db, applicantId);
  return rows.map((row) => ({
    applicantId: row.applicantId as ApplicantId,
    recipientAccountId: row.actorAccountId as AccountId,
    actions: row.actions as PermissionAction[],
    purpose: SUPPORT_ACCESS_PURPOSE,
    status: 'ACTIVE' as const,
    // A support grant needs no separate acceptance step — the approver's
    // sign-off at creation time is what stands in for it; acceptedAt is set
    // to startAt so evaluateGrant's "not yet accepted" check never fires.
    acceptedAt: row.startAt.toISOString(),
    startAt: row.startAt.toISOString(),
    expiryAt: row.expiryAt.toISOString(),
  }));
}
