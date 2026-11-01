import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { clampLimit } from './paging';
import { type PlatformAuthInput, isPlatformOwner } from './platform-roles';

/**
 * Commercial override (Commercial V1 COM-02, master directive Part 5 §7's
 * final line: "platform admin; reason; expiry; audit; cannot bypass
 * security/consent/release gates").
 *
 * The last of COM-02's originally-scoped items: a platform owner's
 * exceptional, time-limited bypass of an organization's commercial
 * entitlement caps (seats, invitations, cases, storage) and any billing
 * suspension -- e.g. "let this org add one more case while a billing
 * dispute is sorted out." Modeled directly on `support-access.ts`'s own
 * scoped-grant shape (reason, expiry, revocable, audited, database-enforced
 * maximum duration), but deliberately NOT that file's two-person
 * approver-distinct-from-actor control: a support grant authorizes access
 * to an applicant's protected content they never consented to, which is why
 * that file needs a second sign-off; this bypasses a commercial capacity
 * NUMBER, not consent-gated data access, so a single platform owner
 * (matching `activateSubscription`/`scheduleDowngrade`'s own single-actor
 * pattern) is the right-sized control.
 *
 * "Cannot bypass security/consent/release gates" is enforced structurally,
 * not by a rule this file writes: `isCommercialOverrideActive` is read by
 * exactly one place, `entitlement-enforcement.ts`'s four commercial
 * capacity checks, which never touch security, consent, or release-gate
 * code at all -- there is no code path here that could widen its own
 * effect into any of those.
 *
 * No uniqueness constraint on `commercialOverrides` -- like `supportGrants`,
 * more than one override can be simultaneously active for the same
 * organization (independently granted, independently revocable);
 * `isCommercialOverrideActive` is a plain existence check across every
 * non-revoked, unexpired row, not a singleton lookup.
 */

export type CommercialOverride = typeof schema.commercialOverrides.$inferSelect;

/** No commercial override may outlive its creation by more than this. Enforced again at the database level (`commercial_overrides_max_duration`). */
export const COMMERCIAL_OVERRIDE_MAX_DURATION_DAYS = 30;

export interface GrantCommercialOverrideInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly organizationId: string;
  readonly reason: string;
  readonly durationDays: number;
}

/**
 * Grant a time-limited commercial override for an organization. Platform-
 * owner-only, step-up gated -- the same sensitivity class as a platform-role
 * grant or a plan assignment.
 */
export async function grantCommercialOverride(
  db: Db,
  input: GrantCommercialOverrideInput,
): Promise<Result<CommercialOverride, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can grant a commercial override'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'granting a commercial override requires reauthentication'),
    );
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));
  if (
    !Number.isFinite(input.durationDays) ||
    input.durationDays <= 0 ||
    input.durationDays > COMMERCIAL_OVERRIDE_MAX_DURATION_DAYS
  ) {
    return err(
      serviceError(
        'invalid',
        `duration must be between 1 and ${COMMERCIAL_OVERRIDE_MAX_DURATION_DAYS} days`,
      ),
    );
  }

  const org = first(
    await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));

  const startAt = new Date();
  const expiryAt = new Date(startAt.getTime() + input.durationDays * 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const override = required(
      first(
        await tx
          .insert(schema.commercialOverrides)
          .values({
            organizationId: input.organizationId,
            grantedByAccountId: input.actor.accountId,
            reason,
            startAt,
            expiryAt,
          })
          .returning(),
      ),
      'commercial override',
    );
    await appendAuditEvent(tx, {
      eventType: 'COMMERCIAL_OVERRIDE_GRANTED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'commercial_override',
      resourceId: override.id,
      reason,
      metadata: {
        organizationId: input.organizationId,
        durationDays: input.durationDays,
        expiryAt: expiryAt.toISOString(),
      },
    });
    return ok(override);
  });
}

export interface RevokeCommercialOverrideInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly overrideId: string;
  readonly reason: string;
}

/** Revoke a commercial override before its natural expiry. Idempotent: revoking an already-revoked override is a no-op success, not an error. */
export async function revokeCommercialOverride(
  db: Db,
  input: RevokeCommercialOverrideInput,
): Promise<Result<CommercialOverride, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can revoke a commercial override'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'revoking a commercial override requires reauthentication'),
    );
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));

  const existing = first(
    await db
      .select()
      .from(schema.commercialOverrides)
      .where(eq(schema.commercialOverrides.id, input.overrideId))
      .limit(1),
  );
  if (!existing) return err(serviceError('not_found', 'commercial override not found'));
  if (existing.revokedAt) return ok(existing);

  return db.transaction(async (tx) => {
    const revoked = required(
      first(
        await tx
          .update(schema.commercialOverrides)
          .set({
            revokedAt: new Date(),
            revokedByAccountId: input.actor.accountId,
            revokedReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(schema.commercialOverrides.id, input.overrideId))
          .returning(),
      ),
      'commercial override',
    );
    await appendAuditEvent(tx, {
      eventType: 'COMMERCIAL_OVERRIDE_REVOKED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'commercial_override',
      resourceId: revoked.id,
      reason,
      metadata: { organizationId: revoked.organizationId },
    });
    return ok(revoked);
  });
}

/**
 * True if this organization currently has at least one non-revoked,
 * unexpired commercial override -- the check `entitlement-enforcement.ts`'s
 * four gated functions call first, before any billing-suspension or
 * capacity check, since an active override bypasses both.
 */
export async function isCommercialOverrideActive(
  db: Db,
  organizationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const active = first(
    await db
      .select({ id: schema.commercialOverrides.id })
      .from(schema.commercialOverrides)
      .where(
        and(
          eq(schema.commercialOverrides.organizationId, organizationId),
          isNull(schema.commercialOverrides.revokedAt),
          gt(schema.commercialOverrides.expiryAt, now),
        ),
      )
      .limit(1),
  );
  return active !== undefined;
}

/** Every commercial override ever granted for an organization, newest first -- full history, including revoked/expired, for audit review. */
export async function listCommercialOverridesForOrganization(
  db: Db,
  organizationId: string,
  /** WP-SB9: only the newest `limit` overrides (1 to 100); the full history when left out. */
  options: { readonly limit?: number } = {},
): Promise<CommercialOverride[]> {
  // Newest first in the database (time, then id), cut only when a page asks for a limit.
  const query = db
    .select()
    .from(schema.commercialOverrides)
    .where(eq(schema.commercialOverrides.organizationId, organizationId))
    .orderBy(desc(schema.commercialOverrides.createdAt), desc(schema.commercialOverrides.id));
  return options.limit === undefined ? query : query.limit(clampLimit(options.limit));
}
