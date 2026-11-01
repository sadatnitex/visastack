import type { PermissionAction } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { assignMember, isActiveMember } from './agency';
import { createApplicant, getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { logoVersion, readOrganizationLogo } from './branding';
import { type Db, first, required, schema } from './db';
import { isEmailAddress } from './email-address';
import { type ServiceError, serviceError } from './errors';
import { queueInvitationEmail } from './invitation-email';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { createMission } from './missions';
import { isOrgAdmin } from './organizations';
import {
  type Page,
  type PageRequest,
  clampLimit,
  cursorOrder,
  cursorTime,
  decodeTimeCursor,
  encodeTimeCursor,
  olderThan,
  toPage,
} from './paging';
import type { KeyManagementPort } from './ports';
import { elapsedSeconds, recordProductEvent } from './product-events';
import { RATE_LIMITS, checkRateLimits } from './rate-limit';
import { acceptGrant, createGrant } from './sharing';
import type { BlobStore } from './storage';

/**
 * Agency invites a traveller (Commercial V1 Part 4 §6, IAM-03; v1.2 PR1/S1 B09).
 *
 * Never checked against an existing account at creation: the PRD is explicit that an agency "may
 * not... claim an existing wallet" or "expose whether email already has VisaStack account", so the
 * agency learns nothing about accounts from creating, previewing or the outcome of an invitation.
 *
 * Bound to its intended recipient (v1.2 PR1/S1): when the agency gave an email address, only an
 * account signed in with that same address may see the invitation's details or accept it. A
 * forwarded link or an unrelated account gets a neutral refusal that names no person, route or
 * case, and the check happens at acceptance, never at creation, so it reveals nothing to the
 * agency. Invitations go to an email address only (owner decision, 25 Oct 2026): a phone
 * number cannot be checked against the signed-in account, so an older invitation stored with
 * one can no longer be opened or accepted by anyone; the agency sends a new one by email.
 *
 * The agency supplies only a minimal display name/contact/route/case-owner; the accepting
 * traveller alone chooses which of their own applicant profiles (existing or newly created) the
 * resulting grant and mission attach to, so the agency can never claim or preload into a wallet it
 * does not own.
 */

export type ClientInvitation = typeof schema.clientInvitations.$inferSelect;

const DEFAULT_EXPIRY_DAYS = 7;

/**
 * Whether a stored contact can still be accepted by someone: a valid email address, checked the
 * same way as at creation. Anything else (a phone number saved before invitations became
 * email-only, or a malformed address saved before creation-time checks) binds to nobody.
 */
export function isAcceptableInvitationContact(contactDestination: string): boolean {
  return isEmailAddress(contactDestination.trim().toLowerCase());
}

/** A contact saved before invitations became email-only (no address at all). */
function isPhoneContact(contactDestination: string): boolean {
  return !contactDestination.includes('@');
}

/** Whether `accountId` may see and accept an invitation sent to `contactDestination`. */
async function isIntendedRecipient(
  db: Db,
  contactDestination: string,
  accountId: string,
): Promise<boolean> {
  // Fails closed: a phone contact binds to nobody, and a malformed address
  // (a trailing dot, a name in angle brackets) matches no account exactly.
  if (isPhoneContact(contactDestination)) return false;
  // Compared exactly as account emails are stored (trimmed, lower case), like team invitations.
  const bound = contactDestination.trim().toLowerCase();
  const account = first(
    await db
      .select({ email: schema.accounts.email })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1),
  );
  return account?.email.trim().toLowerCase() === bound;
}

/** The same neutral refusal sharing invitations give: it names no person, route or case. */
const WRONG_RECIPIENT_MESSAGE = 'Use the email address that received this invitation.';

/** For an older invitation sent to a phone number: what to do instead, naming nothing else. */
const PHONE_INVITATION_MESSAGE =
  'This invitation can no longer be used. Ask the agency to send you a new one by email.';

const ALREADY_USED_MESSAGE = 'this invitation has already been used or revoked';

/**
 * Why someone was refused, worked out once. A phone invitation is refused for everyone, so its
 * status says nothing about any person: someone reopening one they already accepted is told it
 * was used, not to ask for a new one (which would create a second case for the same client).
 */
function refusalOf(invitation: {
  readonly contactDestination: string;
  readonly status: string;
}): { readonly reason: 'wrong_recipient' | 'phone_invitation'; readonly message: string } {
  if (!isPhoneContact(invitation.contactDestination)) {
    return { reason: 'wrong_recipient', message: WRONG_RECIPIENT_MESSAGE };
  }
  return {
    reason: 'phone_invitation',
    message: invitation.status === 'PENDING' ? PHONE_INVITATION_MESSAGE : ALREADY_USED_MESSAGE,
  };
}

/**
 * Audits a refused attempt (someone else's invitation, or an older phone invitation nobody can
 * accept, told apart by `reason`): ids only, never an address or a name. Once per account,
 * invitation and stage, so refreshing a page cannot fill the permanent audit log. A failure to
 * record never changes the refusal the person sees.
 */
async function recordWrongRecipient(
  db: Db,
  actorAccountId: string,
  invitationId: string,
  organizationId: string,
  stage: 'preview' | 'accept',
  reason: 'wrong_recipient' | 'phone_invitation',
): Promise<void> {
  try {
    const already = first(
      await db
        .select({ seq: schema.auditEvents.seq })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.eventType, 'CLIENT_INVITATION_WRONG_RECIPIENT'),
            eq(schema.auditEvents.actorAccountId, actorAccountId),
            eq(schema.auditEvents.resourceId, invitationId),
            sql`${schema.auditEvents.metadata}->>'stage' = ${stage}`,
          ),
        )
        .limit(1),
    );
    if (already) return;
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'CLIENT_INVITATION_WRONG_RECIPIENT',
        actorAccountId,
        method: 'MANUAL',
        result: 'DENIED',
        resourceType: 'client_invitation',
        resourceId: invitationId,
        reason,
        metadata: { organizationId, stage },
      });
    });
  } catch {
    // The refusal stands either way; only the record of it is missing.
  }
}

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
export const DEFAULT_CLIENT_GRANT_ACTIONS: readonly PermissionAction[] = [
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
  readonly encryption?: KeyManagementPort;
}

export interface CreatedClientInvitation {
  readonly invitation: ClientInvitation;
  /** The raw, unhashed token. Exists only here and in whatever link the caller hands to the invitee, never logged or persisted in plaintext. */
  readonly rawToken: string;
  /** Whether an invitation email was queued; when false the agency shares the link itself. */
  readonly emailQueued: boolean;
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
  // An address must be a real one: a malformed address would bind the
  // invitation to nobody and no email could be sent. Email only: a phone
  // number cannot be checked against the account that accepts.
  if (!isEmailAddress(contactDestination.toLowerCase())) {
    return err(
      serviceError('invalid', 'Enter a valid email address for the client, like name@example.com.'),
    );
  }

  const rateLimit = await checkRateLimits(db, [
    {
      input: {
        subjectId: input.actorAccountId,
        action: 'client_invitation.create',
        label: 'invitation',
      },
      config: RATE_LIMITS.CLIENT_INVITATION_CREATE,
    },
    {
      input: {
        subjectId: input.organizationId,
        action: 'client_invitation.create.org',
        label: 'invitation',
      },
      config: RATE_LIMITS.CLIENT_INVITATION_CREATE_ORG,
    },
  ]);
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const invitation = required(
      first(
        await tx
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
    // The key service is called before the audit write: that write takes the global audit lock,
    // which must never be held while waiting on a network call.
    // The address is valid by now, so an email goes out whenever the server can send one.
    const emailQueued = input.encryption !== undefined;
    if (input.encryption) {
      await queueInvitationEmail(tx, {
        kind: 'client',
        invitationId: invitation.id,
        organizationId: input.organizationId,
        email: contactDestination,
        rawToken,
        encryption: input.encryption,
      });
    }
    await appendAuditEvent(tx, {
      eventType: 'CLIENT_INVITATION_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'client_invitation',
      resourceId: invitation.id,
      metadata: { organizationId: input.organizationId },
    });
    // Growth loop 1: counted once per invitation, with no address, name or text. It never
    // stands in the way of the invitation (savepoint, see `recordProductEvent`).
    await recordProductEvent(tx, {
      eventType: 'CLIENT_INVITE_SENT',
      accountId: input.actorAccountId,
      organizationId: input.organizationId,
      onceFor: invitation.id,
    });
    return ok({ invitation, rawToken, emailQueued });
  });
}

/**
 * What the intended recipient sees before deciding. The agency-typed person name is deliberately
 * absent (v1.2 B09: no applicant name in a preview); the traveller names their own profile.
 */
export interface ClientInvitationPreview {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly requestedRoute: string | null;
  readonly grantActions: readonly PermissionAction[];
  readonly expiresAt: Date;
}

/**
 * Read-only lookup, deliberately never consuming the token (same reasoning
 * as `invitations.ts`'s `previewOrganizationInvitation`): a GET request must
 * never spend a one-time token as a side effect of rendering. Only the
 * intended recipient (`viewerAccountId`) sees the details.
 */
export async function previewClientInvitation(
  db: Db,
  rawToken: string,
  viewerAccountId: string,
): Promise<Result<ClientInvitationPreview, ServiceError>> {
  const tokenHash = hashInvitationToken(rawToken);
  const row = first(
    await db
      .select({
        id: schema.clientInvitations.id,
        organizationId: schema.clientInvitations.organizationId,
        organizationName: schema.organizations.name,
        contactDestination: schema.clientInvitations.contactDestination,
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
  // First, so someone else's link says nothing about whether it was used, revoked or expired.
  if (!(await isIntendedRecipient(db, row.contactDestination, viewerAccountId))) {
    const refusal = refusalOf(row);
    await recordWrongRecipient(
      db,
      viewerAccountId,
      row.id,
      row.organizationId,
      'preview',
      refusal.reason,
    );
    return err(serviceError('forbidden', refusal.message));
  }
  if (row.status !== 'PENDING') {
    return err(serviceError('invalid', 'this invitation has already been used or revoked'));
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return err(serviceError('invalid', 'this invitation has expired'));
  }
  return ok({
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    requestedRoute: row.requestedRoute,
    grantActions: DEFAULT_CLIENT_GRANT_ACTIONS,
    expiresAt: row.expiresAt,
  });
}

/**
 * What anyone holding the link may see before signing in (growth loop 1, Option B: name the agency
 * and show the terms). Only what the page needs to be honest about who is asking and what they
 * would get: never the person the agency typed, the address it was sent to, the route it names,
 * who sent it, or any id. `verified` is the platform's own review result (the organization is
 * ACTIVE), and the agency's logo and accent colour are given only then, so an agency nobody has
 * reviewed is never dressed as one that was.
 */
export interface PublicClientInvitationView {
  readonly agencyName: string;
  readonly verified: boolean;
  /** Present only for a verified agency that chose one. */
  readonly accentColor: string | null;
  /** A short token that changes with the logo, present only for a verified agency that has one. */
  readonly logoVersion: string | null;
  /** The access the agency receives on acceptance: the real grant, so the terms shown are true. */
  readonly grantActions: readonly PermissionAction[];
  readonly expiresAt: Date;
}

/** An agency that has been reviewed is ACTIVE; one still waiting for review may invite, but is shown plainly. */
const OPEN_ORGANIZATION_STATUSES: readonly string[] = ['ACTIVE', 'PENDING_VERIFICATION'];

/**
 * The one lookup behind the public page and its logo: by hashed token only, and `null` for a token
 * that is unknown, expired, revoked, already used, or that acceptance would refuse (the agency can
 * no longer invite, or the person who sent it is no longer an OWNER or ADMIN), so the caller can say
 * the same thing for all of them. An invitation nobody can accept (an older one sent
 * to a phone number) is closed too.
 */
async function findOpenInvitationForPublic(
  db: Db,
  rawToken: string,
  now: Date,
): Promise<{ readonly organizationId: string; readonly view: PublicClientInvitationView } | null> {
  const row = first(
    await db
      .select({
        organizationId: schema.clientInvitations.organizationId,
        invitedByAccountId: schema.clientInvitations.invitedByAccountId,
        contactDestination: schema.clientInvitations.contactDestination,
        expiresAt: schema.clientInvitations.expiresAt,
        status: schema.clientInvitations.status,
        agencyName: schema.organizations.name,
        agencyStatus: schema.organizations.status,
        accentColor: schema.organizations.accentColor,
        logoObjectKey: schema.organizations.logoObjectKey,
      })
      .from(schema.clientInvitations)
      .innerJoin(
        schema.organizations,
        eq(schema.clientInvitations.organizationId, schema.organizations.id),
      )
      .where(eq(schema.clientInvitations.tokenHash, hashInvitationToken(rawToken)))
      .limit(1),
  );
  if (!row) return null;
  if (row.status !== 'PENDING') return null;
  // The same test acceptance makes: past its end, it is closed.
  if (row.expiresAt.getTime() < now.getTime()) return null;
  if (!isAcceptableInvitationContact(row.contactDestination)) return null;
  if (!OPEN_ORGANIZATION_STATUSES.includes(row.agencyStatus)) return null;
  // Acceptance is made on behalf of the person who sent it, who must still be an active OWNER or
  // ADMIN then (`acceptGrant`). One who has since left or been demoted leaves an offer nobody can
  // take up, so it is closed here too rather than shown and refused after sign-up.
  if (!(await isOrgAdmin(db, row.invitedByAccountId, row.organizationId))) return null;
  const verified = row.agencyStatus === 'ACTIVE';
  return {
    organizationId: row.organizationId,
    view: {
      agencyName: row.agencyName,
      verified,
      accentColor: verified ? row.accentColor : null,
      logoVersion: verified && row.logoObjectKey ? logoVersion(row.logoObjectKey) : null,
      grantActions: DEFAULT_CLIENT_GRANT_ACTIONS,
      expiresAt: row.expiresAt,
    },
  };
}

/**
 * The public, signed-out view of a client invitation (see `PublicClientInvitationView`). Read-only
 * and never consuming the token. `null` means "no longer open", and is the same answer for a token
 * that never existed, one that expired, was withdrawn or was used: nothing here lets anyone tell
 * those apart or test which addresses an agency has invited. The caller limits how often one
 * network address may ask.
 */
export async function getPublicClientInvitationView(
  db: Db,
  rawToken: string,
  now: Date = new Date(),
): Promise<PublicClientInvitationView | null> {
  return (await findOpenInvitationForPublic(db, rawToken, now))?.view ?? null;
}

/** The inviting agency's logo for the public page: only for a still-open invitation from a verified agency. */
export async function readPublicClientInvitationLogo(
  db: Db,
  storage: Pick<BlobStore, 'getObject'>,
  rawToken: string,
  now: Date = new Date(),
): Promise<{ readonly bytes: Uint8Array; readonly contentType: string } | undefined> {
  const found = await findOpenInvitationForPublic(db, rawToken, now);
  if (!found?.view.verified || found.view.logoVersion === null) return undefined;
  return readOrganizationLogo(db, storage, found.organizationId);
}

export interface ClientsJoined {
  /** Clients who have joined through an invitation, all time. */
  readonly total: number;
  /** Clients who joined (first accepted) in the 30 days up to now. */
  readonly last30Days: number;
}

const CLIENTS_JOINED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How many clients have joined an organization through an invitation, counted from the
 * invitation records themselves (so it covers every past invitation, with no dependence on
 * the event log). A client is a person: someone who accepts a second invitation from the same
 * agency is still one client, and counts as having joined when they first accepted. Two numbers
 * and nothing else: no names, no addresses. Any active member may see it, like the other counts
 * on the agency dashboard; anyone else is refused.
 */
export async function getClientsJoined(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly now?: Date;
  },
): Promise<Result<ClientsJoined, ServiceError>> {
  if (!(await isActiveMember(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only a member of this organization can see this'));
  }
  const since = new Date((input.now ?? new Date()).getTime() - CLIENTS_JOINED_WINDOW_MS);
  const perClient = db
    .select({
      firstAcceptedAt: sql<Date>`min(${schema.clientInvitations.acceptedAt})`.as(
        'first_accepted_at',
      ),
    })
    .from(schema.clientInvitations)
    .where(
      and(
        eq(schema.clientInvitations.organizationId, input.organizationId),
        eq(schema.clientInvitations.status, 'ACCEPTED'),
      ),
    )
    // One row per person; an accepting account that no longer exists still counts as its own client.
    .groupBy(
      sql`coalesce(${schema.clientInvitations.acceptedByAccountId}::text, ${schema.clientInvitations.id}::text)`,
    )
    .as('per_client');
  const row = first(
    await db
      .select({
        total: sql<string>`count(*)`,
        last30Days: sql<string>`count(*) filter (where ${perClient.firstAcceptedAt} >= ${since.toISOString()})`,
      })
      .from(perClient),
  );
  return ok({ total: Number(row?.total ?? 0), last30Days: Number(row?.last30Days ?? 0) });
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
  /** The grant to the agency, for the traveller's own next choice on it (S22: AI tools). */
  readonly grantId: string;
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
  // Checked first, before anything is claimed or created: a forwarded link
  // cannot spend the invitation or learn whether it was used, revoked or expired.
  if (!(await isIntendedRecipient(db, invitation.contactDestination, input.actorAccountId))) {
    const refusal = refusalOf(invitation);
    await recordWrongRecipient(
      db,
      input.actorAccountId,
      invitation.id,
      invitation.organizationId,
      'accept',
      refusal.reason,
    );
    return err(serviceError('forbidden', refusal.message));
  }
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
      // Growth loop 1: once per invitation; the number is the seconds from sent to accepted.
      await recordProductEvent(tx, {
        eventType: 'CLIENT_INVITE_ACCEPTED',
        accountId: input.actorAccountId,
        organizationId: invitation.organizationId,
        metricValue: elapsedSeconds(invitation.createdAt),
        onceFor: invitation.id,
      });

      return ok({
        applicantId,
        missionId: mission.id,
        organizationId: invitation.organizationId,
        grantId: grant.id,
      });
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

/**
 * WP-SB5: one page of the invitations the full read below returns, newest first (time, then id), at most `limit`
 * (clamped to 1 to 100), optionally in one status only, with how many match in all. The same
 * OWNER/ADMIN check and the same organization filter apply on every page; `before` is the previous
 * page's `nextCursor`, and one made for another organization, or malformed, gives the first page.
 */
export async function listClientInvitations(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
  options: ClientInvitationsPageRequest,
): Promise<Result<ClientInvitationsPage, ServiceError>>;
/** List an organization's client invitations, newest first (org OWNER/ADMIN only). */
export async function listClientInvitations(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<Result<readonly ClientInvitation[], ServiceError>>;
export async function listClientInvitations(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
  options?: ClientInvitationsPageRequest,
): Promise<Result<readonly ClientInvitation[] | ClientInvitationsPage, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can view invitations'));
  }
  const ofOrganization = eq(schema.clientInvitations.organizationId, input.organizationId);
  if (!options) {
    const rows = await db
      .select()
      .from(schema.clientInvitations)
      .where(ofOrganization)
      .orderBy(desc(schema.clientInvitations.createdAt));
    return ok(rows);
  }
  const matching = options.status
    ? and(ofOrganization, eq(schema.clientInvitations.status, options.status))
    : ofOrganization;
  const limit = clampLimit(options.limit);
  const cursorScope = `org:${input.organizationId}:client-invitations`;
  const after = decodeTimeCursor(options.before, cursorScope);
  const [rows, counts] = await Promise.all([
    db
      .select({
        invitation: schema.clientInvitations,
        cursorAt: cursorTime(schema.clientInvitations.createdAt),
      })
      .from(schema.clientInvitations)
      .where(
        after
          ? and(
              matching,
              olderThan(schema.clientInvitations.createdAt, schema.clientInvitations.id, after),
            )
          : matching,
      )
      .orderBy(...cursorOrder(schema.clientInvitations.createdAt, schema.clientInvitations.id))
      .limit(limit + 1),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.clientInvitations).where(matching),
  ]);
  const page = toPage(rows, limit, (last) =>
    encodeTimeCursor({ at: last.cursorAt, id: last.invitation.id }, cursorScope),
  );
  return ok({
    items: page.items.map((row) => row.invitation),
    nextCursor: page.nextCursor,
    total: Number(counts[0]?.total ?? 0),
  });
}

/** WP-SB5: what one page of an organization's client invitations asks for. */
export interface ClientInvitationsPageRequest extends PageRequest {
  /** Only invitations in this status; left out means every status. */
  readonly status?: ClientInvitation['status'];
}

/** WP-SB5: one page of an organization's client invitations. */
export interface ClientInvitationsPage extends Page<ClientInvitation> {
  /** How many invitations match in all. */
  readonly total: number;
}

/**
 * PRV-02 (master directive Part 7 §11: "abandoned invite metadata: 30d").
 * The client-invitation sibling of `invitations.ts`'s
 * `sweepAbandonedOrganizationInvitations` -- same reasoning throughout:
 * PENDING past its own `expiresAt`, or explicitly REVOKED, either 30+ days
 * ago; ACCEPTED is never swept (a legitimate historical record, not
 * abandoned metadata); hard-deletes the row since nothing holds a real FK to
 * it and the row's whole point is the invitee's own contact destination.
 */
const ABANDONED_INVITATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_ABANDONED_INVITATION_SWEEP_LIMIT = 200;

export interface AbandonedClientInvitationSweepResult {
  readonly checked: number;
  readonly deleted: number;
}

export async function sweepAbandonedClientInvitations(
  db: Db,
  limit = DEFAULT_ABANDONED_INVITATION_SWEEP_LIMIT,
): Promise<AbandonedClientInvitationSweepResult> {
  const cutoff = new Date(Date.now() - ABANDONED_INVITATION_AGE_MS);
  const stale = await db
    .select({ id: schema.clientInvitations.id })
    .from(schema.clientInvitations)
    .where(
      or(
        and(
          eq(schema.clientInvitations.status, 'PENDING'),
          lt(schema.clientInvitations.expiresAt, cutoff),
        ),
        and(
          eq(schema.clientInvitations.status, 'REVOKED'),
          lt(schema.clientInvitations.revokedAt, cutoff),
        ),
      ),
    )
    .limit(limit);

  let deleted = 0;
  for (const row of stale) {
    const result = await db
      .delete(schema.clientInvitations)
      .where(eq(schema.clientInvitations.id, row.id))
      .returning({ id: schema.clientInvitations.id });
    if (result.length > 0) deleted++;
  }
  return { checked: stale.length, deleted };
}
