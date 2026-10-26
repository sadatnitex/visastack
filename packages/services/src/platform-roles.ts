import { type Result, err, ok } from '@visastack/core';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { enqueueNotificationBothChannels } from './notifications';

/**
 * Namespaced advisory-lock key serializing platform-role grant decisions
 * (arbitrary, stable constant — distinct from `audit.ts`'s
 * `AUDIT_CHAIN_LOCK_KEY`).
 */
const GRANT_LOCK_KEY = 9_000_001;

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
  'QUALITY_ADMIN',
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

/**
 * Concern-scoped platform actions (docs/audits/post-programme-defect-register.md
 * finding #15). `PLATFORM_OWNER` performs every action (role administration
 * and ultimate platform governance — never listed below, so it is never
 * confused with a fifth "super admin" layered on top); every other role is
 * confined to exactly the one concern its name describes, with zero
 * overlap between `SECURITY_ADMIN`, `COMPLIANCE_ADMIN`, and `SUPPORT_ADMIN`.
 * `SUPPORT_ADMIN` deliberately has "no security, retention, or
 * role-management authority" (master directive) — it is scoped to bounded
 * operational actions only (retrying a stuck job, reconciling storage,
 * managing requirement-pack content).
 */
export type PlatformAction =
  | 'RETENTION_POLICY_SET'
  | 'LEGAL_HOLD_PLACE'
  | 'LEGAL_HOLD_RELEASE'
  | 'RETENTION_PURGE'
  | 'ERASURE_JOB_RETRY'
  | 'ORGANIZATION_REVIEW'
  | 'ORGANIZATION_SUSPEND'
  | 'ORGANIZATION_TERMINATE'
  | 'PROCESSING_JOB_RETRY'
  | 'ORPHAN_RECONCILE'
  | 'PACK_MANAGE'
  | 'COMPLAINT_MANAGE'
  | 'FEEDBACK_VIEW'
  | 'AI_SETTINGS_MANAGE'
  | 'DOCUMENT_PROTECTION_MANAGE'
  | 'APPLICANT_DIRECTORY_VIEW'
  | 'AUDIT_TRAIL_VIEW'
  | 'SUPPORT_GRANT_APPROVE';

const ACTION_ROLES: Readonly<Record<PlatformAction, Exclude<PlatformRole, 'PLATFORM_OWNER'>>> = {
  RETENTION_POLICY_SET: 'COMPLIANCE_ADMIN',
  LEGAL_HOLD_PLACE: 'COMPLIANCE_ADMIN',
  LEGAL_HOLD_RELEASE: 'COMPLIANCE_ADMIN',
  RETENTION_PURGE: 'COMPLIANCE_ADMIN',
  ERASURE_JOB_RETRY: 'COMPLIANCE_ADMIN',
  ORGANIZATION_REVIEW: 'SECURITY_ADMIN',
  ORGANIZATION_SUSPEND: 'SECURITY_ADMIN',
  ORGANIZATION_TERMINATE: 'SECURITY_ADMIN',
  // Provider/model/API-key configuration is a credential-security concern,
  // the same family as the other SECURITY_ADMIN actions above -- not a new,
  // non-overlapping concern the way QUALITY_ADMIN was for complaints/
  // feedback, so this extends SECURITY_ADMIN rather than adding a sixth role.
  AI_SETTINGS_MANAGE: 'SECURITY_ADMIN',
  // Which documents need a fresh sign-in check before preview or download
  // (document-protection.ts) is an access-security rule, the same family as
  // the actions above, so it extends SECURITY_ADMIN rather than adding a role.
  DOCUMENT_PROTECTION_MANAGE: 'SECURITY_ADMIN',
  // Reading every traveller's name, the whole audit trail, and approving a person's
  // access to someone else's records are privacy and security concerns, never an
  // operations one: SUPPORT_ADMIN holds none of them (S2, M13 and M14).
  APPLICANT_DIRECTORY_VIEW: 'COMPLIANCE_ADMIN',
  AUDIT_TRAIL_VIEW: 'SECURITY_ADMIN',
  SUPPORT_GRANT_APPROVE: 'SECURITY_ADMIN',
  PROCESSING_JOB_RETRY: 'SUPPORT_ADMIN',
  ORPHAN_RECONCILE: 'SUPPORT_ADMIN',
  PACK_MANAGE: 'SUPPORT_ADMIN',
  // TRU-04 (Part 7 §9): "authorized quality users" -- a genuinely distinct
  // concern from COMPLIANCE_ADMIN (legal/retention/holds), never overlapped
  // with it, matching this table's own zero-overlap discipline.
  COMPLAINT_MANAGE: 'QUALITY_ADMIN',
  FEEDBACK_VIEW: 'QUALITY_ADMIN',
};

/**
 * True if the account can perform `action` — as `PLATFORM_OWNER` (or
 * bootstrap), or as the one specific role `ACTION_ROLES` names for it.
 * Replaces the previous universal "any active role" check
 * (`hasAnyPlatformRole`), which made `SUPPORT_ADMIN` functionally identical
 * to `SECURITY_ADMIN`/`COMPLIANCE_ADMIN` for every gated action (finding
 * #15) — enforced here, in the service layer, so every call site gets the
 * real concern-scoped answer rather than re-deriving it.
 */
export async function canPerformPlatformAction(
  db: Db,
  input: PlatformAuthInput,
  action: PlatformAction,
): Promise<boolean> {
  if (await isPlatformOwner(db, input)) return true;
  const requiredRole = ACTION_ROLES[action];
  const active = first(
    await db
      .select({ n: count() })
      .from(schema.platformRoles)
      .where(
        and(
          eq(schema.platformRoles.accountId, input.accountId),
          eq(schema.platformRoles.role, requiredRole),
          isNull(schema.platformRoles.revokedAt),
        ),
      ),
  );
  return (active?.n ?? 0) > 0;
}

/** The account's current active grant of exactly this role, if any. */
async function findActiveGrant(
  db: Db,
  accountId: string,
  role: PlatformRole,
): Promise<PlatformRoleGrant | undefined> {
  return first(
    await db
      .select()
      .from(schema.platformRoles)
      .where(
        and(
          eq(schema.platformRoles.accountId, accountId),
          eq(schema.platformRoles.role, role),
          isNull(schema.platformRoles.revokedAt),
        ),
      )
      .limit(1),
  );
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
    // Serialize the whole grant decision — not just the insert — behind a
    // fixed-key advisory lock, held for the rest of this transaction. Two
    // concurrent bootstrap-authorized grants for DIFFERENT target accounts
    // could otherwise each independently observe an empty table below and
    // both become PLATFORM_OWNER, even if neither caller requested that
    // role: the partial unique index (finding #40) only guards duplicate
    // rows for the SAME (account, role) pair, and doesn't help when the
    // accounts differ (Codex review, PR #65). Serializing here also makes
    // the ordinary same-(account,role) race fully impossible at the
    // application level, rather than merely recovered-from after the fact.
    await tx.execute(sql`select pg_advisory_xact_lock(${GRANT_LOCK_KEY})`);

    // Authorization is re-checked HERE, inside the lock — not before the
    // transaction — because a check made before acquiring the lock can be
    // stale by the time this runs: two allowlisted bootstrap actors can both
    // pass a pre-lock `isPlatformOwner` check while the table is still
    // empty, but only the first to acquire the lock actually creates the
    // real owner; bootstrap authority ends for everyone else the instant
    // that grant commits. Without re-checking here, the second (loser)
    // caller — never a real owner, and no longer bootstrap-eligible once
    // the first caller's grant exists — would still slip its own requested
    // role through on stale authorization (Codex review, PR #65).
    if (!(await isPlatformOwner(tx, input.actor))) {
      return err(serviceError('forbidden', 'only a platform owner can grant platform roles'));
    }

    // The first grant this table ever receives establishes the platform's
    // owner, regardless of what role the (necessarily still-bootstrapping)
    // caller requested — otherwise a bootstrap actor could grant themselves
    // (or anyone) a non-owner role, permanently disable the bootstrap path
    // (`totalGrantCount(tx) !== 0`), and leave no PLATFORM_OWNER able to
    // issue another grant, locking the installation out of role management
    // (docs/audits/post-programme-defect-register.md finding #16).
    const isBootstrapGrant = (await totalGrantCount(tx)) === 0;
    const role = isBootstrapGrant ? 'PLATFORM_OWNER' : input.role;

    // Idempotent: a repeated submission or retry granting the same
    // (account, role) pair must never create a second active row —
    // revoking one of two duplicates would report success while the other
    // silently continues granting the same authority (Codex review, PR
    // #65). Race-free now that the lock above serializes every concurrent
    // caller through this exact check.
    const existingActive = await findActiveGrant(tx, input.targetAccountId, role);
    if (existingActive) return ok(existingActive);

    const grant = required(
      first(
        await tx
          .insert(schema.platformRoles)
          .values({
            accountId: input.targetAccountId,
            workosUserId: target.workosUserId,
            role,
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
      metadata: {
        targetAccountId: input.targetAccountId,
        role,
        ...(isBootstrapGrant && role !== input.role ? { requestedRole: input.role } : {}),
      },
    });

    // NTF-02: "security/account changes" -- the target is notified about
    // their OWN account, a different recipient shape than every other wired
    // event (no applicant/org context; never the granting actor's own
    // `reason` text).
    await enqueueNotificationBothChannels(tx, {
      eventType: 'PLATFORM_ROLE_GRANTED',
      resourceId: grant.id,
      recipientAccountId: input.targetAccountId,
      payload: {
        subject: 'Your platform role changed',
        summary: `You were granted the ${role} platform role.`,
        deepLinkPath: '/app/account',
      },
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

  return db.transaction(async (tx) => {
    if (grant.role === 'PLATFORM_OWNER') {
      // Lock every PLATFORM_OWNER row so a concurrent revocation of a
      // DIFFERENT owner serializes against this one instead of both
      // independently observing "another owner exists" and both succeeding,
      // leaving zero active owners (docs/audits/post-programme-defect-register.md
      // finding #18) — mirrors `setMembershipActive`'s existing
      // last-active-owner lock in `organizations.ts`.
      const owners = await tx
        .select()
        .from(schema.platformRoles)
        .where(eq(schema.platformRoles.role, 'PLATFORM_OWNER'))
        .for('update');
      const otherActiveOwners = owners.filter(
        (o) => o.revokedAt === null && o.id !== input.grantId,
      );
      if (otherActiveOwners.length === 0) {
        return err(serviceError('invalid', 'cannot revoke the sole remaining platform owner'));
      }
    }
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
    // accountId is nullable (finding #17: deleting an account sets it null
    // rather than erasing this append-only row) -- nobody left to notify if
    // that already happened.
    if (updated.accountId) {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'PLATFORM_ROLE_REVOKED',
        resourceId: updated.id,
        recipientAccountId: updated.accountId,
        payload: {
          subject: 'Your platform role changed',
          summary: `Your ${updated.role} platform role was revoked.`,
          deepLinkPath: '/app/account',
        },
      });
    }
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
