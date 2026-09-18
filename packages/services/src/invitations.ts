import { createHash, randomBytes } from 'node:crypto';
import type { MembershipRole } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import { getAccountByEmail } from './accounts';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isOrgAdmin } from './organizations';

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

const TOKEN_BYTES = 32;
const DEFAULT_EXPIRY_DAYS = 7;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

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

  const existingAccount = await getAccountByEmail(db, email);
  if (existingAccount) {
    return err(
      serviceError(
        'invalid',
        'this email already has a VisaStack account; add them as a member directly instead',
      ),
    );
  }

  const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(rawToken);
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
  const tokenHash = hashToken(input.rawToken);
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
  const tokenHash = hashToken(input.rawToken);
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
