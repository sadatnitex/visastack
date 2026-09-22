import type { PermissionAction } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import { assignMember, isActiveMember } from './agency';
import { createApplicant, getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { createMission } from './missions';
import { isOrgAdmin } from './organizations';
import { acceptGrant, createGrant } from './sharing';

/**
 * Agency invites a traveller (Commercial V1 Part 4 §6, IAM-03 exactly).
 *
 * Deliberately never keyed by email at acceptance and never checked against
 * an existing account at creation, unlike `invitations.ts`'s organization
 * invitations: the PRD is explicit that an agency "may not... claim an
 * existing wallet" or "expose whether email already has VisaStack account."
 * Acceptance is gated purely on holding the token plus being authenticated
 * as ANY account, never on an email match, the only design that cannot
 * leak account-existence information back to the inviting agency. The
 * agency supplies only a minimal display name/contact/route/case-owner; the
 * accepting traveller alone chooses which of their own applicant profiles
 * (existing or newly created) the resulting grant and mission attach to,
 * so the agency can never claim or preload into a wallet it does not own.
 */

export type ClientInvitation = typeof schema.clientInvitations.$inferSelect;

const DEFAULT_EXPIRY_DAYS = 7;

/**
 * What an agency actually receives once a client invitation is accepted:
 * enough to actually operate the case: view, preview, comment, propose
 * profile edits, and `MANAGE` (assign members, add notes, request
 * evidence, drive mission state). Never the step-up-gated actions
 * (`DOWNLOAD_ORIGINAL`/`EXPORT_PROFILE`/`SHARE`) or edit approval; those
 * remain a separate, deliberate, later scope expansion through the
 * ordinary sharing UI, on the same "never silently grows" principle
 * SHR-01's category-scope snapshot already uses. `MANAGE` is not
 * optional here: `assignMember` (called right below once this grant is
 * accepted) itself requires a `MANAGE`-scoped grant on the mission via
 * `orgGrantPermits`, and without it the named case owner could never
 * actually be assigned.
 */
const DEFAULT_CLIENT_GRANT_ACTIONS: readonly PermissionAction[] = [
  'VIEW_METADATA',
  'PREVIEW',
  'COMMENT',
  'PROPOSE_EDIT',
  'MANAGE',
];

export interface CreateClientInvitationInput {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly caseOwnerAccountId: string;
  readonly displayName: string;
  readonly contactDestination: string;
  readonly requestedRoute?: string;
}

export interface CreatedClientInvitation {
  readonly invitation: ClientInvitation;
  /** The raw, unhashed token. Exists only here and in whatever link the caller hands to the invitee, never logged, never persisted. */
  readonly rawToken: string;
}

/** Invite a traveller as a new client (org OWNER/ADMIN only, matching `assignMember`'s own authority requirement for the case-owner assignment this invitation produces on acceptance). */
export async function createClientInvitation(
  db: Db,
  input: CreateClientInvitationInput,
): Promise<Result<CreatedClientInvitation, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can invite a client'));
  }
  if (!(await isActiveMember(db, input.caseOwnerAccountId, input.organizationId))) {
    return err(
      serviceError('invalid', 'the case owner must be an active member of this organization'),
    );
  }
  const displayName = input.displayName.trim();
  if (displayName.length === 0) return err(serviceError('invalid', 'a display name is required'));
  const contactDestination = input.contactDestination.trim();
  if (contactDestination.length === 0) {
    return err(serviceError('invalid', 'a contact destination is required'));
  }

  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const invitation = required(
    first(
      await db
        .insert(schema.clientInvitations)
        .values({
          organizationId: input.organizationId,
          caseOwnerAccountId: input.caseOwnerAccountId,
          displayName,
          contactDestination,
          requestedRoute: input.requestedRoute?.trim() || null,
          tokenHash,
          invitedByAccountId: input.actorAccountId,
          expiresAt,
        })
        .returning(),
    ),
    'client invitation',
  );
  await appendAuditEvent(db, {
    eventType: 'CLIENT_INVITATION_CREATED',
    actorAccountId: input.actorAccountId,
    method: 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'client_invitation',
    resourceId: invitation.id,
    metadata: { organizationId: input.organizationId },
  });
  return ok({ invitation, rawToken });
}

export interface ClientInvitationPreview {
  readonly organizationName: string;
  readonly displayName: string;
  readonly requestedRoute: string | null;
  readonly grantActions: readonly PermissionAction[];
  readonly expiresAt: Date;
}

/**
 * Read-only lookup, deliberately never consuming the token (same reasoning
 * as `invitations.ts`'s `previewOrganizationInvitation`): a GET request must
 * never spend a one-time token as a side effect of rendering.
 */
export async function previewClientInvitation(
  db: Db,
  rawToken: string,
): Promise<Result<ClientInvitationPreview, ServiceError>> {
  const tokenHash = hashInvitationToken(rawToken);
  const row = first(
    await db
      .select({
        organizationName: schema.organizations.name,
        displayName: schema.clientInvitations.displayName,
        requestedRoute: schema.clientInvitations.requestedRoute,
        expiresAt: schema.clientInvitations.expiresAt,
        status: schema.clientInvitations.status,
      })
      .from(schema.clientInvitations)
      .innerJoin(
        schema.organizations,
        eq(schema.clientInvitations.organizationId, schema.organizations.id),
      )
      .where(eq(schema.clientInvitations.tokenHash, tokenHash))
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
    displayName: row.displayName,
    requestedRoute: row.requestedRoute,
    grantActions: DEFAULT_CLIENT_GRANT_ACTIONS,
    expiresAt: row.expiresAt,
  });
}

/** Carries a `ServiceError` out through a transaction rollback (a returned `err()` does not itself abort the transaction, only a throw does; mirrors `documents.ts`'s `RegistrationAborted`). */
class ClientInvitationAcceptAborted extends Error {
  constructor(readonly serviceError: ServiceError) {
    super(serviceError.message);
  }
}

export type ApplicantChoice =
  | { readonly kind: 'existing'; readonly applicantId: string }
  | { readonly kind: 'new'; readonly displayName?: string };

export interface AcceptClientInvitationInput {
  readonly actorAccountId: string;
  readonly rawToken: string;
  readonly applicantChoice: ApplicantChoice;
}

export interface AcceptedClientInvitation {
  readonly applicantId: string;
  readonly missionId: string;
  readonly organizationId: string;
}

/**
 * Accept a pending client invitation (directive Part 4 §6, steps 1-7):
 * resolves or creates the traveller's own applicant profile (never the
 * agency's choice), creates the case (Mission) and a default-scoped grant
 * to the inviting organization, and records the invitation's own case
 * owner as the mission's assignee. All in one transaction: a failure at
 * any step (most commonly missing CORE_PROCESSING/SHARING consent, or the
 * inviting organization having since been suspended) leaves nothing
 * half-linked.
 */
export async function acceptClientInvitation(
  db: Db,
  input: AcceptClientInvitationInput,
): Promise<Result<AcceptedClientInvitation, ServiceError>> {
  const tokenHash = hashInvitationToken(input.rawToken);
  const invitation = first(
    await db
      .select()
      .from(schema.clientInvitations)
      .where(eq(schema.clientInvitations.tokenHash, tokenHash))
      .limit(1),
  );
  if (!invitation) return err(serviceError('not_found', 'invitation not found'));
  if (invitation.status !== 'PENDING') {
    return err(serviceError('invalid', 'this invitation has already been used or revoked'));
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    return err(serviceError('invalid', 'this invitation has expired'));
  }
  if (input.applicantChoice.kind === 'existing') {
    const applicant = await getApplicant(db, input.applicantChoice.applicantId);
    if (!applicant || applicant.ownerAccountId !== input.actorAccountId) {
      return err(serviceError('forbidden', 'not authorized for this applicant'));
    }
  }

  try {
    return await db.transaction(async (tx) => {
      const claimed = first(
        await tx
          .update(schema.clientInvitations)
          .set({
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            acceptedByAccountId: input.actorAccountId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.clientInvitations.id, invitation.id),
              eq(schema.clientInvitations.status, 'PENDING'),
            ),
          )
          .returning(),
      );
      if (!claimed) {
        throw new ClientInvitationAcceptAborted(
          serviceError('invalid', 'this invitation has already been used or revoked'),
        );
      }

      const applicantId =
        input.applicantChoice.kind === 'existing'
          ? input.applicantChoice.applicantId
          : await (async () => {
              const created = await createApplicant(tx, {
                actorAccountId: input.actorAccountId,
                ownerAccountId: input.actorAccountId,
                displayName:
                  input.applicantChoice.kind === 'new' && input.applicantChoice.displayName?.trim()
                    ? input.applicantChoice.displayName.trim()
                    : invitation.displayName,
              });
              if (!created.ok) throw new ClientInvitationAcceptAborted(created.error);
              return created.value.id;
            })();

      const mission = await (async () => {
        const created = await createMission(tx, {
          actorAccountId: input.actorAccountId,
          applicantId,
          title: invitation.requestedRoute ?? invitation.displayName,
          ...(invitation.requestedRoute ? { purpose: invitation.requestedRoute } : {}),
          // CAS-01: this case's primary owner is exactly the org that
          // invited the traveller here, the whole reason this flow exists.
          ownerOrganizationId: invitation.organizationId,
        });
        if (!created.ok) throw new ClientInvitationAcceptAborted(created.error);
        return created.value;
      })();

      const grant = await (async () => {
        const created = await createGrant(tx, {
          actorAccountId: input.actorAccountId,
          applicantId,
          recipientOrganizationId: invitation.organizationId,
          actions: DEFAULT_CLIENT_GRANT_ACTIONS,
          purpose: invitation.requestedRoute
            ? `Agency-initiated case: ${invitation.requestedRoute}`
            : 'Agency-initiated case',
          missionId: mission.id,
        });
        if (!created.ok) throw new ClientInvitationAcceptAborted(created.error);
        return created.value;
      })();

      // A grant starts PENDING_ACCEPTANCE (sharing.ts): `authorize()` denies
      // it outright until accepted, and `assignMember` below would fail
      // every single time with "no current grant covering that mission"
      // otherwise. The traveller's own act of accepting this invitation IS
      // their decision to share with the inviting org, so there is no
      // separate confirmation left to wait for; acceptance happens right
      // here, as the invited admin (re-verified live as an active
      // OWNER/ADMIN by `acceptGrant` itself, not merely trusted from
      // invitation-creation time). Unlike `assignMember` below, a failure
      // here IS fatal: without an ACTIVE grant the org has no access at all,
      // so accepting would otherwise silently produce a case nobody at the
      // agency can actually see.
      const acceptedGrant = await acceptGrant(tx, {
        actorAccountId: invitation.invitedByAccountId,
        grantId: grant.id,
      });
      if (!acceptedGrant.ok) throw new ClientInvitationAcceptAborted(acceptedGrant.error);

      // Bookkeeping only (assignMemberAction's own doc comment: it "never
      // grants access on its own"); the grant above is what actually lets
      // the org reach this case. A failure here (the named case owner was
      // deactivated between invitation and acceptance) must not undo the
      // real access the traveller just granted, so it is logged, not
      // thrown.
      const assigned = await assignMember(tx, {
        actorAccountId: invitation.invitedByAccountId,
        organizationId: invitation.organizationId,
        memberAccountId: invitation.caseOwnerAccountId,
        missionId: mission.id,
      });
      if (!assigned.ok) {
        console.error('[acceptClientInvitation] case-owner assignment failed', assigned.error);
      }

      await tx
        .update(schema.clientInvitations)
        .set({ acceptedApplicantId: applicantId, acceptedMissionId: mission.id })
        .where(eq(schema.clientInvitations.id, invitation.id));

      await appendAuditEvent(tx, {
        eventType: 'CLIENT_INVITATION_ACCEPTED',
        actorAccountId: input.actorAccountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId,
        resourceType: 'client_invitation',
        resourceId: invitation.id,
        metadata: {
          organizationId: invitation.organizationId,
          missionId: mission.id,
          grantId: grant.id,
        },
      });

      return ok({ applicantId, missionId: mission.id, organizationId: invitation.organizationId });
    });
  } catch (error) {
    if (error instanceof ClientInvitationAcceptAborted) return err(error.serviceError);
    throw error;
  }
}

/** Revoke a still-pending client invitation (org OWNER/ADMIN only). */
export async function revokeClientInvitation(
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
  // `invitations.ts`'s `revokeOrganizationInvitation` already guards against.
  const updated = await db
    .update(schema.clientInvitations)
    .set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.clientInvitations.id, input.invitationId),
        eq(schema.clientInvitations.organizationId, input.organizationId),
        eq(schema.clientInvitations.status, 'PENDING'),
      ),
    )
    .returning({ id: schema.clientInvitations.id });
  if (updated.length === 0) {
    return err(serviceError('invalid', 'invitation not found, already used, or already revoked'));
  }
  return ok(undefined);
}

/** List an organization's client invitations, newest first (org OWNER/ADMIN only). */
export async function listClientInvitations(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<Result<readonly ClientInvitation[], ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can view invitations'));
  }
  const rows = await db
    .select()
    .from(schema.clientInvitations)
    .where(eq(schema.clientInvitations.organizationId, input.organizationId))
    .orderBy(desc(schema.clientInvitations.createdAt));
  return ok(rows);
}
