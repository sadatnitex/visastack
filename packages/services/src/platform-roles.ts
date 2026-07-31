import { type Result, err, ok } from '@visastack/core';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Platform administration (master directive §7 "PR 5").
 *
 * Replaces an env-var allowlist as the authority for platform-level actions
 * with an accountable, auditable, revocable role model. `PLATFORM_OWNER` is
 * the only role that can grant or revoke roles (including its own) — every
 * other role is scoped to the specific concern its name describes. This is
 * not a fifth "super admin" layered on top of the four; PLATFORM_OWNER is
 * simply the top of these four, the same way an organization's OWNER
 * membership role already works elsewhere in this schema.
 *
 * Bootstrap: before any role has ever been granted, `bootstrapEmails` (the
 * caller-supplied, still-env-sourced allowlist) grants owner-equivalent
 * access — otherwise nobody could ever grant the first role. The instant one
 * real grant exists, the bootstrap path stops being consulted, permanently,
 * even if the env var is left configured — it is a one-time seed, never an
 * ongoing authority.
 */

export type PlatformRole = (typeof schema.platformRoles.$inferSelect)['role'];
export type PlatformRoleGrant = typeof schema.platformRoles.$inferSelect;

export const PLATFORM_ROLES: readonly PlatformRole[] = [
  'PLATFORM_OWNER',
  'SECURITY_ADMIN',
  'COMPLIANCE_ADMIN',
  'SUPPORT_ADMIN',
];

export interface PlatformAuthInput {
  readonly accountId: string;
  readonly email: string;
  /** Still env-sourced (ADMIN_EMAILS) — passed in, never read from process.env here (services stay env-agnostic). */
  readonly bootstrapEmails: readonly string[];
}

async function totalGrantCount(db: Db): Promise<number> {
  const row = first(await db.select({ n: count() }).from(schema.platformRoles));
  return row?.n ?? 0;
}

function isBootstrapEligible(input: PlatformAuthInput): boolean {
  return input.bootstrapEmails.includes(input.email.trim().toLowerCase());
}

/** True if the account holds any currently-active platform role (or the table is still unbootstrapped and the email is allowlisted). */
export async function hasAnyPlatformRole(db: Db, input: PlatformAuthInput): Promise<boolean> {
  const active = first(
    await db
      .select({ n: count() })
      .from(schema.platformRoles)
      .where(
        and(
          eq(schema.platformRoles.accountId, input.accountId),
          isNull(schema.platformRoles.revokedAt),
        ),
      ),
  );
  if ((active?.n ?? 0) > 0) return true;
  return (await totalGrantCount(db)) === 0 && isBootstrapEligible(input);
}

/** True if the account holds an active PLATFORM_OWNER grant (or bootstrap applies) — the only role that can manage roles. */
export async function isPlatformOwner(db: Db, input: PlatformAuthInput): Promise<boolean> {
  const owner = first(
    await db
      .select({ n: count() })
      .from(schema.platformRoles)
      .where(
        and(
          eq(schema.platformRoles.accountId, input.accountId),
          eq(schema.platformRoles.role, 'PLATFORM_OWNER'),
          isNull(schema.platformRoles.revokedAt),
        ),
      ),
  );
  if ((owner?.n ?? 0) > 0) return true;
  return (await totalGrantCount(db)) === 0 && isBootstrapEligible(input);
}

export interface GrantPlatformRoleInput {
  readonly actor: PlatformAuthInput;
  readonly targetAccountId: string;
  readonly role: PlatformRole;
  readonly reason: string;
  /**
   * Required `true`, honestly derived from a genuine WorkOS reauthentication
   * (master directive §7 "PR 5" — "platform-role changes"; see
   * `apps/web/src/lib/step-up.ts`). Never defaults or is inferred — a caller
   * must explicitly assert it, same discipline as `bulkExport`/`createGrant`.
   */
  readonly stepUpSatisfied: boolean;
}

/** Grant a platform role. PLATFORM_OWNER-only (including during bootstrap). Step-up gated. Audited. */
export async function grantPlatformRole(
  db: Db,
  input: GrantPlatformRoleInput,
): Promise<Result<PlatformRoleGrant, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can grant platform roles'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'granting a platform role requires reauthentication'),
    );
  }
  if (input.reason.trim().length === 0) return err(serviceError('invalid', 'a reason is required'));
  const target = first(
    await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, input.targetAccountId))
      .limit(1),
  );
  if (!target) return err(serviceError('not_found', 'account not found'));

  return db.transaction(async (tx) => {
    const grant = required(
      first(
        await tx
          .insert(schema.platformRoles)
          .values({
            accountId: input.targetAccountId,
            workosUserId: target.workosUserId,
            role: input.role,
            assignedByAccountId: input.actor.accountId,
            reason: input.reason.trim(),
          })
          .returning(),
      ),
      'platform role grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'PLATFORM_ROLE_GRANTED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'platform_role',
      resourceId: grant.id,
      metadata: { targetAccountId: input.targetAccountId, role: input.role },
    });
    return ok(grant);
  });
}

export interface RevokePlatformRoleInput {
  readonly actor: PlatformAuthInput;
  readonly grantId: string;
  readonly reason: string;
  /** Required `true` — see `GrantPlatformRoleInput.stepUpSatisfied`. */
  readonly stepUpSatisfied: boolean;
}

/**
 * Revoke a platform role grant. PLATFORM_OWNER-only. Step-up gated. Never
 * deletes the row — marks it revoked, preserving the full history. Refuses
 * to revoke the last active PLATFORM_OWNER grant (mirrors the existing
 * "cannot deactivate the sole remaining active org owner" safeguard) so the
 * system can never end up with no one able to manage roles at all.
 */
export async function revokePlatformRole(
  db: Db,
  input: RevokePlatformRoleInput,
): Promise<Result<PlatformRoleGrant, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can revoke platform roles'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'revoking a platform role requires reauthentication'),
    );
  }
  if (input.reason.trim().length === 0) return err(serviceError('invalid', 'a reason is required'));
  const grant = first(
    await db
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.id, input.grantId))
      .limit(1),
  );
  if (!grant) return err(serviceError('not_found', 'platform role grant not found'));
  if (grant.revokedAt) return err(serviceError('invalid', 'this grant is already revoked'));

  if (grant.role === 'PLATFORM_OWNER') {
    const otherActiveOwners = first(
      await db
        .select({ n: count() })
        .from(schema.platformRoles)
        .where(
          and(
            eq(schema.platformRoles.role, 'PLATFORM_OWNER'),
            isNull(schema.platformRoles.revokedAt),
          ),
        ),
    );
    if ((otherActiveOwners?.n ?? 0) <= 1) {
      return err(serviceError('invalid', 'cannot revoke the sole remaining platform owner'));
    }
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.platformRoles)
          .set({
            revokedAt: new Date(),
            revokedByAccountId: input.actor.accountId,
            revokedReason: input.reason.trim(),
          })
          .where(eq(schema.platformRoles.id, input.grantId))
          .returning(),
      ),
      'platform role grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'PLATFORM_ROLE_REVOKED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'platform_role',
      resourceId: updated.id,
      metadata: { targetAccountId: updated.accountId, role: updated.role },
    });
    return ok(updated);
  });
}

/** All currently active grants (platform-admin overview), newest first. */
export async function listActivePlatformRoles(db: Db): Promise<PlatformRoleGrant[]> {
  const rows = await db
    .select()
    .from(schema.platformRoles)
    .where(isNull(schema.platformRoles.revokedAt))
    .orderBy(desc(schema.platformRoles.assignedAt));
  return rows;
}
