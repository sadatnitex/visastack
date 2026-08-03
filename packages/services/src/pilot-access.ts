import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * The server-authoritative controlled-pilot access boundary
 * (docs/audits/post-programme-defect-register.md finding #2 — "Invite-only
 * pilot access"). Decides whether a WorkOS identity may receive a NEW local
 * account. `withSession` (apps/web/src/lib/session.ts) calls
 * `checkPilotAccess` BEFORE `provisionAccount`, every time — never after.
 *
 * This is a provisioning-time gate, not a continuous access re-check: once
 * an identity has a bound local account, it always passes (immutable
 * WorkOS-ID binding stays authoritative — email alone is never treated as
 * identity here, matching `provisionAccount`'s own discipline), and a later
 * invitation revocation never retroactively locks out someone already
 * provisioned. Invitations are append-only and audited: revoking never
 * deletes the row, so the full history of who was invited, by whom, and
 * why is always reconstructable.
 */

export type PilotInvitation = typeof schema.pilotInvitations.$inferSelect;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface PilotAccessDecision {
  readonly allowed: boolean;
  /**
   * Set whenever a matched invitation is in play — either as the actual
   * reason access was granted, or (when an account already exists) a
   * dangling row to best-effort clean up. See `mustClaimInvitation` for
   * which case this is.
   */
  readonly invitationId: string | null;
  /**
   * True only when `invitationId` is the SOLE reason `allowed` is true (no
   * account exists yet). The caller MUST call `claimInvitation` and deny
   * access if the claim fails — an admin racing a revocation against this
   * exact sign-in must always win (Codex review, PR #65). False when an
   * account already exists independently: `invitationId`, if set, is a
   * dangling row to best-effort clean up, never a gate — a failed claim
   * there is harmless, since access never depended on it.
   */
  readonly mustClaimInvitation: boolean;
}

export interface CheckPilotAccessInput {
  readonly email: string;
  readonly workosUserId?: string | null;
  /**
   * Env-sourced bootstrap/ops allowlist, passed in by the caller — services
   * stay env-agnostic, mirroring `platform-roles.ts`'s `bootstrapEmails`.
   */
  readonly allowlistEmails: readonly string[];
  /**
   * True only for a non-real deployment (local dev, tests, PR previews) —
   * a practical, explicit bypass, never applied to a real deployment
   * (controlled pilot or commercial).
   */
  readonly bypass: boolean;
}

/** True if a local account already exists for this identity (by immutable WorkOS id, or — for a not-yet-bound legacy/no-id caller — by email). */
async function accountAlreadyExists(
  db: Db,
  email: string,
  workosUserId: string | null,
): Promise<boolean> {
  if (workosUserId) {
    const byId = first(
      await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.workosUserId, workosUserId))
        .limit(1),
    );
    if (byId) return true;
  }
  const byEmail = first(
    await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.email, email))
      .limit(1),
  );
  return byEmail !== undefined;
}

/**
 * An invitation is "active" only while both un-revoked AND not yet
 * consumed — once `claimInvitation` sets `acceptedAt`, the row is
 * historical, not a standing grant of access. Without the `acceptedAt`
 * check, a consumed invitation would remain matchable forever: if the
 * admitted account is later deleted (or its bound identity's email
 * changes), a different identity later controlling the same address could
 * reuse the already-spent invitation to provision a second account — the
 * exact replay this boundary exists to prevent (Codex review, PR #65).
 * Matches the partial unique index on `pilot_invitations` (schema.ts),
 * which enforces this same "active" definition at the database level.
 */
async function findActiveInvitation(db: Db, email: string): Promise<PilotInvitation | undefined> {
  return first(
    await db
      .select()
      .from(schema.pilotInvitations)
      .where(
        and(
          eq(schema.pilotInvitations.email, email),
          isNull(schema.pilotInvitations.revokedAt),
          isNull(schema.pilotInvitations.acceptedAt),
        ),
      )
      .limit(1),
  );
}

/**
 * Decide whether a WorkOS identity may receive a NEW local account. Order:
 * (1) an identity already bound to an account always passes; (2) the
 * bootstrap/ops allowlist; (3) an active (non-revoked) invitation for this
 * email. Anything else is denied — the caller must not provision an
 * account and must show a safe, non-account-creating denial screen.
 */
export async function checkPilotAccess(
  db: Db,
  input: CheckPilotAccessInput,
): Promise<PilotAccessDecision> {
  if (input.bypass) return { allowed: true, invitationId: null, mustClaimInvitation: false };

  const email = normalizeEmail(input.email);
  const workosUserId = input.workosUserId?.trim() || null;

  if (await accountAlreadyExists(db, email, workosUserId)) {
    // Recovery path, not the common case (Codex review, PR #65): a pending
    // invitation can still exist for an already-provisioned account only if
    // an earlier sign-in provisioned the account but crashed/failed before
    // `claimInvitation`/`attributeInvitation` ran. Claiming it here means
    // such a row can never survive to be replayed after this account is
    // later deleted. This is the ONLY way such a row can coexist with an
    // existing account, now that `createInvitation` refuses to invite an
    // already-admitted email. `mustClaimInvitation: false` — access here
    // never depended on the invitation, so a failed claim is harmless.
    const dangling = await findActiveInvitation(db, email);
    return { allowed: true, invitationId: dangling?.id ?? null, mustClaimInvitation: false };
  }
  if (input.allowlistEmails.includes(email)) {
    return { allowed: true, invitationId: null, mustClaimInvitation: false };
  }
  const invitation = await findActiveInvitation(db, email);
  if (invitation) {
    return { allowed: true, invitationId: invitation.id, mustClaimInvitation: true };
  }

  return { allowed: false, invitationId: null, mustClaimInvitation: false };
}

/**
 * Atomically claims a still-active invitation, before the account is
 * actually provisioned — the only thing standing between a concurrent
 * revocation and a provisioning already in flight (Codex review, PR #65):
 * without this, an admin revoking an invitation the instant after
 * `checkPilotAccess` read it as active could not stop that sign-in from
 * still provisioning an account. Conditioned on both `revokedAt` and
 * `acceptedAt` still being null, so it's also safe against two concurrent
 * callers racing to claim the same invitation — only one wins. Returns
 * whether THIS call won the claim; a caller whose decision required this
 * invitation (`mustClaimInvitation`) must deny access if it returns false.
 */
export async function claimInvitation(db: Db, invitationId: string): Promise<boolean> {
  const claimed = first(
    await db
      .update(schema.pilotInvitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(schema.pilotInvitations.id, invitationId),
          isNull(schema.pilotInvitations.revokedAt),
          isNull(schema.pilotInvitations.acceptedAt),
        ),
      )
      .returning({ id: schema.pilotInvitations.id }),
  );
  return claimed !== undefined;
}

/**
 * Attributes a successfully claimed invitation to the account it actually
 * provisioned. Called only after `claimInvitation` has already won the
 * claim for this exact invitation — `acceptedAt` is already set, so no
 * further conditional guard is needed here; this only fills in which
 * account consumed it. Deliberately best-effort: a failure here must never
 * undo the account it just admitted, so callers must not roll back
 * provisioning if this fails.
 */
export async function attributeInvitation(
  db: Db,
  input: { readonly invitationId: string; readonly accountId: string },
): Promise<void> {
  await db
    .update(schema.pilotInvitations)
    .set({ acceptedAccountId: input.accountId })
    .where(eq(schema.pilotInvitations.id, input.invitationId));
}

/**
 * Releases a claim that was won but never consumed — provisioning failed
 * (an identity conflict, a transient database/audit error) after
 * `claimInvitation` already committed `acceptedAt`, so the invitation must
 * become findable again rather than permanently locking out a legitimate
 * retry until an admin re-invites them (Codex review, PR #65). Guarded on
 * `acceptedAccountId IS NULL`: a claim that WAS successfully attributed to a
 * real account (`attributeInvitation` already ran) can never be undone by a
 * stray or late release call.
 */
export async function releaseInvitationClaim(db: Db, invitationId: string): Promise<void> {
  await db
    .update(schema.pilotInvitations)
    .set({ acceptedAt: null })
    .where(
      and(
        eq(schema.pilotInvitations.id, invitationId),
        isNull(schema.pilotInvitations.acceptedAccountId),
      ),
    );
}

export interface CreateInvitationInput {
  readonly actorAccountId: string;
  readonly email: string;
  readonly reason?: string;
}

/**
 * Invite an email address into the controlled pilot. Audited. Idempotent:
 * re-inviting an email that already has an active invitation returns the
 * existing row rather than creating a duplicate (a "replayed invitation"
 * must never multiply standing or create ambiguity about which row is
 * authoritative).
 *
 * The pre-insert check alone cannot close a concurrent-request race (two
 * calls for the same email both observing "no active invitation yet"
 * before either commits) — the database-level partial unique index on
 * `pilot_invitations` (schema.ts) is the real guard; a violation here means
 * a concurrent caller won the race, and its row is what this call returns
 * (Codex review, PR #65).
 *
 * Refuses an email that already has a provisioned account (Codex review,
 * PR #65): that sign-in never consumes a fresh invitation (it takes the
 * `accountAlreadyExists` fast path in `checkPilotAccess`), so a re-invite
 * would create a standing, never-consumed row — a latent credential able to
 * admit a different identity if this account is later deleted.
 */
export async function createInvitation(
  db: Db,
  input: CreateInvitationInput,
): Promise<Result<PilotInvitation, ServiceError>> {
  const email = normalizeEmail(input.email);
  if (email.length === 0 || !email.includes('@')) {
    return err(serviceError('invalid', 'a valid email is required'));
  }
  if (await accountAlreadyExists(db, email, null)) {
    return err(serviceError('invalid', 'this email already has an account — no invitation needed'));
  }
  const existingActive = await findActiveInvitation(db, email);
  if (existingActive) return ok(existingActive);

  try {
    return await db.transaction(async (tx) => {
      const invitation = required(
        first(
          await tx
            .insert(schema.pilotInvitations)
            .values({
              email,
              invitedByAccountId: input.actorAccountId,
              reason: input.reason?.trim() ? input.reason.trim() : null,
            })
            .returning(),
        ),
        'pilot invitation',
      );
      await appendAuditEvent(tx, {
        eventType: 'PILOT_INVITATION_CREATED',
        actorAccountId: input.actorAccountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'pilot_invitation',
        resourceId: invitation.id,
        metadata: { email },
      });
      return ok(invitation);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const concurrent = await findActiveInvitation(db, email);
      if (concurrent) return ok(concurrent);
    }
    throw error;
  }
}

export interface RevokeInvitationInput {
  readonly actorAccountId: string;
  readonly invitationId: string;
  readonly reason: string;
}

/**
 * Revoke a pilot invitation. Never deletes the row — marks it revoked,
 * preserving the full history. Only blocks a NOT-yet-provisioned future
 * sign-in; an account already provisioned from this invitation keeps its
 * access (provisioning-time boundary, not a continuous gate — see this
 * module's top-level doc comment).
 */
export async function revokeInvitation(
  db: Db,
  input: RevokeInvitationInput,
): Promise<Result<PilotInvitation, ServiceError>> {
  if (input.reason.trim().length === 0) return err(serviceError('invalid', 'a reason is required'));
  const invitation = first(
    await db
      .select()
      .from(schema.pilotInvitations)
      .where(eq(schema.pilotInvitations.id, input.invitationId))
      .limit(1),
  );
  if (!invitation) return err(serviceError('not_found', 'invitation not found'));
  if (invitation.revokedAt)
    return err(serviceError('invalid', 'this invitation is already revoked'));

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.pilotInvitations)
          .set({
            revokedAt: new Date(),
            revokedByAccountId: input.actorAccountId,
            revokedReason: input.reason.trim(),
          })
          .where(eq(schema.pilotInvitations.id, input.invitationId))
          .returning(),
      ),
      'pilot invitation',
    );
    await appendAuditEvent(tx, {
      eventType: 'PILOT_INVITATION_REVOKED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pilot_invitation',
      resourceId: updated.id,
      metadata: { email: updated.email },
    });
    return ok(updated);
  });
}

/** All invitations, newest first (platform-admin overview). */
export async function listInvitations(db: Db): Promise<PilotInvitation[]> {
  const rows = await db.select().from(schema.pilotInvitations);
  return [...rows].sort((a, b) => b.invitedAt.getTime() - a.invitedAt.getTime());
}
