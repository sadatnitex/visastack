import type { MembershipRole } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { getAccountByEmail } from './accounts';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { checkInvitationEntitlement, checkSeatEntitlement } from './entitlement-enforcement';
import { type ServiceError, serviceError } from './errors';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { isOrgAdmin } from './organizations';
import { RATE_LIMITS, checkRateLimits } from './rate-limit';

/**
 * Secure organization member invitations (Commercial V1 Part 4 §5): lets an
 * org OWNER/ADMIN invite someone by email who has no VisaStack account yet.
 * `organizations.ts`'s own `addMembership` already covers the case where the
 * invitee's account already exists; this covers the case it explicitly
 * cannot ("No VisaStack account for that email. They must sign in once
 * first.").
 *
 * A raw token is minted once at creation time, handed back only to the
 * caller, and never persisted; only its SHA-256 hash is stored, so a
 * database read alone (a leaked backup, a compromised read replica) can
 * never reconstruct a working invitation link. Recipient-bound by `email`,
 * checked against the accepting account's own WorkOS-verified email at
 * accept time, never just "whoever holds the link." Single-use via the
 * `PENDING` -> `ACCEPTED`/`REVOKED` transition, a terminal status that can
 * never move again. Race-safe via the same compare-and-set-on-status
 * pattern `sharing.ts`'s `acceptGrant` already uses.
 */

export type OrganizationInvitation = typeof schema.organizationInvitations.$inferSelect;
export type Membership = typeof schema.memberships.$inferSelect;

const DEFAULT_EXPIRY_DAYS = 7;

export interface CreateOrganizationInvitationInput {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: MembershipRole;
}

export interface CreatedOrganizationInvitation {
  readonly invitation: OrganizationInvitation;
  /** The raw, unhashed token. Exists only here and in whatever link the caller hands to the invitee, never logged, never persisted. */
  readonly rawToken: string;
}

/** Invite someone by email who has no VisaStack account yet (org OWNER/ADMIN only). */
export async function createOrganizationInvitation(
  db: Db,
  input: CreateOrganizationInvitationInput,
): Promise<Result<CreatedOrganizationInvitation, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can invite members'));
  }
  const email = input.email.trim().toLowerCase();
  if (email.length === 0) return err(serviceError('invalid', 'email is required'));

  // Checked BEFORE the account lookup below, deliberately: that lookup tells
  // the caller whether an email is already registered, an account-enumeration
  // oracle an org admin could otherwise probe at any speed. Actor first, then
  // the organization's shared bucket (see `checkRateLimits`).
  const rateLimit = await checkRateLimits(db, [
    {
      input: {
        subjectId: input.actorAccountId,
        action: 'org_invitation.create',
        label: 'invitation',
      },
      config: RATE_LIMITS.ORG_INVITATION_CREATE,
    },
    {
      input: {
        subjectId: input.organizationId,
        action: 'org_invitation.create.org',
        label: 'invitation',
      },
      config: RATE_LIMITS.ORG_INVITATION_CREATE_ORG,
    },
  ]);
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  const existingAccount = await getAccountByEmail(db, email);
  if (existingAccount) {
    return err(
      serviceError(
        'invalid',
        'this email already has a VisaStack account; add them as a member directly instead',
      ),
    );
  }

  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    // Superseded rather than left dangling: at most one live PENDING
    // invitation per (org, email), so there is never ambiguity about which
    // link is the current one, and a stale earlier token stops working the
    // moment a fresh one is minted.
    await tx
      .update(schema.organizationInvitations)
      .set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.organizationInvitations.organizationId, input.organizationId),
          eq(schema.organizationInvitations.email, email),
          eq(schema.organizationInvitations.status, 'PENDING'),
        ),
      );

    // Checked AFTER the supersede update above, not before: re-inviting the
    // same email replaces its own stale pending slot 1-for-1 rather than
    // consuming an additional one, so the stale row must already be REVOKED
    // (and excluded from the pending count) before this check runs.
    const seatCheck = await checkInvitationEntitlement(tx, input.organizationId);
    if (!seatCheck.ok) return err(seatCheck.error);

    const invitation = required(
      first(
        await tx
          .insert(schema.organizationInvitations)
          .values({
            organizationId: input.organizationId,
            email,
            role: input.role,
            tokenHash,
            invitedByAccountId: input.actorAccountId,
            expiresAt,
          })
          .returning(),
      ),
      'organization invitation',
    );
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_INVITATION_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization_invitation',
      resourceId: invitation.id,
      metadata: { organizationId: input.organizationId, role: input.role },
    });
    return ok({ invitation, rawToken });
  });
}

export interface OrganizationInvitationPreview {
  readonly organizationName: string;
  readonly role: MembershipRole;
  readonly invitedEmail: string;
  readonly expiresAt: Date;
  /** Whether `actorEmail` matches the invitation's own recipient email. Informational only for the UI — `acceptOrganizationInvitation` independently re-verifies this itself and never trusts this flag as the real authorization decision. */
  readonly emailMatches: boolean;
}

/**
 * Read-only lookup, deliberately never consuming the token: a one-time
 * invitation token must not be spent as a side effect of a GET request
 * (link prefetching, a scanner following the URL) — only an explicit,
 * authenticated form submission through `acceptOrganizationInvitation`
 * actually accepts it.
 */
export async function previewOrganizationInvitation(
  db: Db,
  input: { readonly rawToken: string; readonly actorEmail: string },
): Promise<Result<OrganizationInvitationPreview, ServiceError>> {
  const tokenHash = hashInvitationToken(input.rawToken);
  const row = first(
    await db
      .select({
        organizationName: schema.organizations.name,
        role: schema.organizationInvitations.role,
        email: schema.organizationInvitations.email,
        expiresAt: schema.organizationInvitations.expiresAt,
        status: schema.organizationInvitations.status,
      })
      .from(schema.organizationInvitations)
      .innerJoin(
        schema.organizations,
        eq(schema.organizationInvitations.organizationId, schema.organizations.id),
      )
      .where(eq(schema.organizationInvitations.tokenHash, tokenHash))
      .limit(1),
  );
  if (!row) return err(serviceError('not_found', 'invitation not found'));
  if (row.status !== 'PENDING') {
    return err(serviceError('invalid', 'this invitation has already been used or revoked'));
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return err(serviceError('invalid', 'this invitation has expired'));
  }
  return ok({
    organizationName: row.organizationName,
    role: row.role,
    invitedEmail: row.email,
    expiresAt: row.expiresAt,
    emailMatches: row.email === input.actorEmail.trim().toLowerCase(),
  });
}

export interface AcceptOrganizationInvitationInput {
  readonly actorAccountId: string;
  /** The accepting account's own authenticated (WorkOS-verified) email, never client-supplied. */
  readonly actorEmail: string;
  readonly rawToken: string;
}

export interface AcceptedOrganizationInvitation {
  readonly membership: Membership;
  readonly organizationId: string;
}

/**
 * Accept a pending invitation. Fails closed on every mismatch: unknown
 * token, already-consumed/revoked status, expiry, or an email that does not
 * match the authenticated caller's own, never a generic "invalid token"
 * that would help an attacker distinguish which failure mode they hit.
 */
export async function acceptOrganizationInvitation(
  db: Db,
  input: AcceptOrganizationInvitationInput,
): Promise<Result<AcceptedOrganizationInvitation, ServiceError>> {
  const tokenHash = hashInvitationToken(input.rawToken);
  const invitation = first(
    await db
      .select()
      .from(schema.organizationInvitations)
      .where(eq(schema.organizationInvitations.tokenHash, tokenHash))
      .limit(1),
  );
  if (!invitation) return err(serviceError('not_found', 'invitation not found'));
  if (invitation.status !== 'PENDING') {
    return err(serviceError('invalid', 'this invitation has already been used or revoked'));
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    return err(serviceError('invalid', 'this invitation has expired'));
  }
  if (invitation.email !== input.actorEmail.trim().toLowerCase()) {
    return err(serviceError('forbidden', 'this invitation was sent to a different email address'));
  }

  return db.transaction(async (tx) => {
    // A genuine re-confirmation (this account is already an active member of
    // this org) consumes no new seat and must never be blocked by a full
    // org -- checked against the pre-write state, before anything below
    // changes it.
    const existingMembership = first(
      await tx
        .select({ active: schema.memberships.active })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.accountId, input.actorAccountId),
            eq(schema.memberships.organizationId, invitation.organizationId),
          ),
        )
        .limit(1),
    );
    if (!existingMembership?.active) {
      const seatCheck = await checkSeatEntitlement(tx, invitation.organizationId);
      if (!seatCheck.ok) return err(seatCheck.error);
    }

    const updated = first(
      await tx
        .update(schema.organizationInvitations)
        .set({
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          acceptedByAccountId: input.actorAccountId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.organizationInvitations.id, invitation.id),
            eq(schema.organizationInvitations.status, 'PENDING'),
          ),
        )
        .returning(),
    );
    if (!updated) {
      return err(serviceError('invalid', 'this invitation has already been used or revoked'));
    }
    const membership = required(
      first(
        await tx
          .insert(schema.memberships)
          .values({
            accountId: input.actorAccountId,
            organizationId: invitation.organizationId,
            role: invitation.role,
          })
          // A second, separate invitation for the same (org, email) accepted
          // after an earlier one already created this membership hits the
          // same unique constraint rather than a fresh insert; treated as a
          // re-confirmation (role/active refreshed to this invitation's own
          // values) instead of a thrown constraint violation.
          .onConflictDoUpdate({
            target: [schema.memberships.accountId, schema.memberships.organizationId],
            set: { role: invitation.role, active: true, updatedAt: new Date() },
          })
          .returning(),
      ),
      'membership',
    );
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_INVITATION_ACCEPTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization_invitation',
      resourceId: invitation.id,
      metadata: { organizationId: invitation.organizationId, role: invitation.role },
    });
    return ok({ membership, organizationId: invitation.organizationId });
  });
}

/** Revoke a still-pending invitation (org OWNER/ADMIN only). */
export async function revokeOrganizationInvitation(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly invitationId: string;
  },
): Promise<Result<void, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can revoke an invitation'));
  }
  // organizationId is part of the WHERE clause itself, not a separate
  // lookup-then-compare, closing the same class of cross-tenant IDOR
  // `organizations.ts`'s own `setMembershipActive` doc comment warns about:
  // an admin of one org must never be able to act on another org's row by
  // ID alone.
  const updated = await db
    .update(schema.organizationInvitations)
    .set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.organizationInvitations.id, input.invitationId),
        eq(schema.organizationInvitations.organizationId, input.organizationId),
        eq(schema.organizationInvitations.status, 'PENDING'),
      ),
    )
    .returning({ id: schema.organizationInvitations.id });
  if (updated.length === 0) {
    return err(serviceError('invalid', 'invitation not found, already used, or already revoked'));
  }
  return ok(undefined);
}

/** List an organization's invitations, newest first (org OWNER/ADMIN only). */
export async function listOrganizationInvitations(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<Result<readonly OrganizationInvitation[], ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can view invitations'));
  }
  const rows = await db
    .select()
    .from(schema.organizationInvitations)
    .where(eq(schema.organizationInvitations.organizationId, input.organizationId))
    .orderBy(desc(schema.organizationInvitations.createdAt));
  return ok(rows);
}

/**
 * PRV-02 (master directive Part 7 §11: "abandoned invite metadata: 30d").
 * Purges an invitation once it can no longer be accepted and has sat in
 * that terminal-but-unactioned state for 30+ days: PENDING past its own
 * `expiresAt`, or explicitly REVOKED. An ACCEPTED invitation is never
 * swept -- it succeeded, and its row is a legitimate historical record ("who
 * invited whom, when"), not abandoned metadata the directive is naming.
 * Hard-deletes the row: unlike `uploadIntents` (kept forever as an audit
 * trail of infrastructure bookkeeping with no PII of its own), an
 * invitation row's whole point is the invitee's own email address -- exactly
 * the "metadata" the directive names for deletion once nothing further can
 * happen to it. Schema-safe: nothing holds a real FK to an invitation row
 * (an audit event references one only by loose `resourceType`/`resourceId`,
 * the same already-established pattern every other deleted-but-audited row
 * in this schema already uses).
 */
const ABANDONED_INVITATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_ABANDONED_INVITATION_SWEEP_LIMIT = 200;

export interface AbandonedOrganizationInvitationSweepResult {
  readonly checked: number;
  readonly deleted: number;
}

export async function sweepAbandonedOrganizationInvitations(
  db: Db,
  limit = DEFAULT_ABANDONED_INVITATION_SWEEP_LIMIT,
): Promise<AbandonedOrganizationInvitationSweepResult> {
  const cutoff = new Date(Date.now() - ABANDONED_INVITATION_AGE_MS);
  const stale = await db
    .select({ id: schema.organizationInvitations.id })
    .from(schema.organizationInvitations)
    .where(
      or(
        and(
          eq(schema.organizationInvitations.status, 'PENDING'),
          lt(schema.organizationInvitations.expiresAt, cutoff),
        ),
        and(
          eq(schema.organizationInvitations.status, 'REVOKED'),
          lt(schema.organizationInvitations.revokedAt, cutoff),
        ),
      ),
    )
    .limit(limit);

  let deleted = 0;
  for (const row of stale) {
    const result = await db
      .delete(schema.organizationInvitations)
      .where(eq(schema.organizationInvitations.id, row.id))
      .returning({ id: schema.organizationInvitations.id });
    if (result.length > 0) deleted++;
  }
  return { checked: stale.length, deleted };
}
