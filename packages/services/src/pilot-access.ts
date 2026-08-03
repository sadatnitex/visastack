import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
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
   * Set only when access was granted via a matched, not-yet-consumed
   * invitation — the caller marks it accepted (`markInvitationAccepted`)
   * after `provisionAccount` actually succeeds, never before.
   */
  readonly invitationId: string | null;
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

async function findActiveInvitation(db: Db, email: string): Promise<PilotInvitation | undefined> {
  return first(
    await db
      .select()
      .from(schema.pilotInvitations)
      .where(
        and(eq(schema.pilotInvitations.email, email), isNull(schema.pilotInvitations.revokedAt)),
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
  if (input.bypass) return { allowed: true, invitationId: null };

  const email = normalizeEmail(input.email);
  const workosUserId = input.workosUserId?.trim() || null;

  if (await accountAlreadyExists(db, email, workosUserId)) {
    return { allowed: true, invitationId: null };
  }
  if (input.allowlistEmails.includes(email)) {
    return { allowed: true, invitationId: null };
  }
  const invitation = await findActiveInvitation(db, email);
  if (invitation) return { allowed: true, invitationId: invitation.id };

  return { allowed: false, invitationId: null };
}

/**
 * Marks an invitation as consumed once its provisioning actually succeeds.
 * Idempotent — only ever sets `acceptedAt` once, so replaying the same
 * invitation across repeated sign-in attempts before/after it's consumed
 * never double-counts or errors. Deliberately best-effort: a failure here
 * must never undo the account it just admitted, so callers must not roll
 * back provisioning if this fails.
 */
export async function markInvitationAccepted(
  db: Db,
  input: { readonly invitationId: string; readonly accountId: string },
): Promise<void> {
  await db
    .update(schema.pilotInvitations)
    .set({ acceptedAt: new Date(), acceptedAccountId: input.accountId })
    .where(
      and(
        eq(schema.pilotInvitations.id, input.invitationId),
        isNull(schema.pilotInvitations.acceptedAt),
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
 */
export async function createInvitation(
  db: Db,
  input: CreateInvitationInput,
): Promise<Result<PilotInvitation, ServiceError>> {
  const email = normalizeEmail(input.email);
  if (email.length === 0 || !email.includes('@')) {
    return err(serviceError('invalid', 'a valid email is required'));
  }
  const existingActive = await findActiveInvitation(db, email);
  if (existingActive) return ok(existingActive);

  return db.transaction(async (tx) => {
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
