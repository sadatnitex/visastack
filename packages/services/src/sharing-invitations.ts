import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gt } from 'drizzle-orm';
import {
  carryRecipientCaseExceptions,
  listCaseExclusionsForApplicant,
  loadInvitationCaseExclusions,
  lockCaseSharing,
} from './access/grant-scope';
import { AuthorizedApplicant } from './access/require-access';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { isEmailAddress } from './email-address';
import { type ServiceError, serviceError } from './errors';
import { queueInvitationEmail } from './invitation-email';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import type { KeyManagementPort } from './ports';
import { type CreateGrantInput, acceptGrant, createGrant, prepareGrantScope } from './sharing';

export type SharingInvitation = typeof schema.sharingInvitations.$inferSelect;

/** Validated scope, fixed expiry and category snapshot. No placeholder account or active grant. */
export async function createSharingInvitation(
  db: Db,
  input: Omit<CreateGrantInput, 'recipientAccountId' | 'recipientOrganizationId'> & {
    readonly email: string;
    readonly encryption: KeyManagementPort;
  },
): Promise<
  Result<{ readonly invitation: SharingInvitation; readonly rawToken: string }, ServiceError>
> {
  const email = input.email.trim().toLowerCase();
  if (!isEmailAddress(email)) return err(serviceError('invalid', 'Enter a valid recipient email.'));
  const account = first(
    await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, input.actorAccountId))
      .limit(1),
  );
  if (!account || account.email?.toLowerCase() === email)
    return err(serviceError('invalid', 'You cannot share with yourself.'));
  return db.transaction(async (tx) => {
    const allCases = !input.missionId;
    // An all-cases invitation takes the person's sharing lock first, like an
    // all-cases grant (access/grant-scope.ts `lockCaseSharing`).
    if (allCases) await lockCaseSharing(tx, input.applicantId);
    const prepared = await prepareGrantScope(tx, input);
    if (!prepared.ok) return prepared;
    const rawToken = generateInvitationToken();
    const invitation = required(
      first(
        await tx
          .insert(schema.sharingInvitations)
          .values({
            missionId: input.missionId ?? null,
            applicantId: input.applicantId,
            invitedByAccountId: input.actorAccountId,
            email,
            tokenHash: hashInvitationToken(rawToken),
            purpose: input.purpose.trim(),
            actions: [...input.actions],
            categories: input.categories ? [...input.categories] : null,
            documentIds: input.documentIds ? [...input.documentIds] : null,
            documentScopeSnapshot: prepared.value.documentScopeSnapshot,
            grantExpiryAt: prepared.value.expiryAt,
            expiresAt: new Date(
              Math.min(Date.now() + 7 * 86400000, prepared.value.expiryAt.getTime()),
            ),
            stepUpSatisfied: input.stepUpSatisfied === true,
          })
          .returning(),
      ),
      'sharing invitation',
    );
    await appendAuditEvent(tx, {
      eventType: 'SHARING_INVITATION_CREATED',
      actorAccountId: input.actorAccountId,
      applicantId: input.applicantId,
      resourceType: 'sharing_invitation',
      resourceId: invitation.id,
      method: 'MANUAL',
      result: 'ALLOWED',
    });
    // Exceptions follow the recipient: an earlier "no" for this email (or
    // the account behind it) binds this invitation too (ADR 0017 amendment).
    if (allCases) {
      await carryRecipientCaseExceptions(tx, {
        applicantId: input.applicantId,
        actorAccountId: input.actorAccountId,
        target: { kind: 'sharing_invitation', id: invitation.id, email },
      });
    }
    await queueInvitationEmail(tx, {
      kind: 'sharing',
      invitationId: invitation.id,
      email,
      rawToken,
      encryption: input.encryption,
    });
    return ok({ invitation, rawToken });
  });
}

export async function previewSharingInvitation(
  db: Db,
  input: { readonly actorAccountId: string; readonly rawToken: string },
): Promise<Result<SharingInvitation, ServiceError>> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.rawToken))
    return err(serviceError('not_found', 'Invitation unavailable.'));
  const invite = first(
    await db
      .select()
      .from(schema.sharingInvitations)
      .where(eq(schema.sharingInvitations.tokenHash, hashInvitationToken(input.rawToken)))
      .limit(1),
  );
  const account = first(
    await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, input.actorAccountId))
      .limit(1),
  );
  if (!invite || !account || invite.email !== account.email?.toLowerCase())
    return err(serviceError('forbidden', 'Use the email address that received this invitation.'));
  if (invite.status !== 'PENDING' || invite.expiresAt.getTime() <= Date.now())
    return err(
      serviceError(
        'invalid',
        'This invitation has expired, was revoked or has already been accepted.',
      ),
    );
  const applicant = await getApplicant(db, invite.applicantId);
  if (!applicant || applicant.ownerAccountId !== invite.invitedByAccountId)
    return err(serviceError('forbidden', 'Invitation unavailable.'));
  return ok(invite);
}

/** Claim once, revalidate owner/consent and restore the original category snapshot atomically. */
export async function acceptSharingInvitation(
  db: Db,
  input: { readonly actorAccountId: string; readonly rawToken: string },
): Promise<Result<string, ServiceError>> {
  return db
    .transaction(async (tx) => {
      // The person's sharing lock comes before the invitation is checked,
      // claimed or its exceptions copied, so answers for a new case recorded
      // at the same moment either land first (and are copied) or wait. Only
      // the record the token names is looked up to find whose lock to take.
      if (/^[A-Za-z0-9_-]{43}$/.test(input.rawToken)) {
        const named = first(
          await tx
            .select({ applicantId: schema.sharingInvitations.applicantId })
            .from(schema.sharingInvitations)
            .where(eq(schema.sharingInvitations.tokenHash, hashInvitationToken(input.rawToken)))
            .limit(1),
        );
        if (named) await lockCaseSharing(tx, named.applicantId);
      }
      const preview = await previewSharingInvitation(tx, input);
      if (!preview.ok) return preview;
      const invite = preview.value;
      if (
        !(await hasConsent(tx, input.actorAccountId, 'CORE_PROCESSING')) ||
        !(await hasConsent(tx, input.actorAccountId, 'SHARING'))
      )
        return err(
          serviceError('consent_required', 'Confirm account and sharing consent before accepting.'),
        );
      const claimed = await tx
        .update(schema.sharingInvitations)
        .set({ status: 'ACCEPTED', updatedAt: new Date() })
        .where(
          and(
            eq(schema.sharingInvitations.id, invite.id),
            eq(schema.sharingInvitations.status, 'PENDING'),
            gt(schema.sharingInvitations.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!claimed.length)
        return err(serviceError('invalid', 'This invitation is no longer pending.'));
      const created = await createGrant(tx, {
        actorAccountId: invite.invitedByAccountId,
        applicantId: invite.applicantId,
        recipientAccountId: input.actorAccountId,
        actions: invite.actions,
        purpose: invite.purpose,
        expiryAt: invite.grantExpiryAt,
        stepUpSatisfied: invite.stepUpSatisfied,
        ...(invite.missionId ? { missionId: invite.missionId } : {}),
        ...(invite.categories ? { categories: invite.categories } : {}),
        ...(invite.documentIds ? { documentIds: invite.documentIds } : {}),
      });
      // Throw to roll back the claimed invitation and every nested write on a rejected grant.
      if (!created.ok) throw new SharingAcceptanceError(created.error);
      await tx
        .update(schema.grants)
        .set({ documentScopeSnapshot: invite.documentScopeSnapshot })
        .where(eq(schema.grants.id, created.value.id));
      // Per-case sharing exceptions (ADR 0017) recorded against this
      // invitation move onto the new grant before it becomes active, in this
      // same transaction, so the grant never reaches a case the owner said no
      // to. Before migration 0090 none can exist, and none are read.
      const carried = await carryCaseExclusions(tx, invite, created.value.id);
      const accepted = await acceptGrant(tx, {
        actorAccountId: input.actorAccountId,
        grantId: created.value.id,
      });
      if (!accepted.ok) throw new SharingAcceptanceError(accepted.error);
      await tx
        .update(schema.sharingInvitations)
        .set({ acceptedGrantId: accepted.value.id })
        .where(eq(schema.sharingInvitations.id, invite.id));
      await appendAuditEvent(tx, {
        eventType: 'SHARING_INVITATION_ACCEPTED',
        actorAccountId: input.actorAccountId,
        applicantId: invite.applicantId,
        grantId: accepted.value.id,
        resourceType: 'sharing_invitation',
        resourceId: invite.id,
        method: 'MANUAL',
        result: 'ALLOWED',
        ...(carried > 0 ? { metadata: { caseExceptions: carried } } : {}),
      });
      return ok(accepted.value.id);
    })
    .catch((error: unknown) => {
      if (error instanceof SharingAcceptanceError) return err(error.serviceError);
      throw error;
    });
}

/**
 * Copies an all-cases invitation's case exceptions onto the grant it became
 * and removes the invitation-bound rows. `createGrant` has usually carried
 * them already (exceptions follow the recipient), so this writes only what is
 * still missing; every row it does write is audited like any other "no".
 * Returns how many the grant holds from this invitation.
 */
async function carryCaseExclusions(
  tx: Db,
  invite: SharingInvitation,
  grantId: string,
): Promise<number> {
  if (invite.missionId !== null) return 0;
  const missionIds = (await loadInvitationCaseExclusions(tx, [invite.id])).get(invite.id) ?? [];
  if (missionIds.length === 0) return 0;
  const inserted = await tx
    .insert(schema.grantCaseExclusions)
    .values(
      missionIds.map((missionId) => ({
        grantId,
        missionId,
        applicantId: invite.applicantId,
        createdByAccountId: invite.invitedByAccountId,
      })),
    )
    .onConflictDoNothing()
    .returning({ missionId: schema.grantCaseExclusions.missionId });
  for (const row of inserted) {
    await appendAuditEvent(tx, {
      eventType: 'GRANT_CASE_EXCLUDED',
      actorAccountId: invite.invitedByAccountId,
      action: 'SHARE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: invite.applicantId,
      missionId: row.missionId,
      grantId,
      resourceType: 'grant',
      resourceId: grantId,
      reason: 'carried_forward',
    });
  }
  await tx
    .delete(schema.grantCaseExclusions)
    .where(eq(schema.grantCaseExclusions.sharingInvitationId, invite.id));
  return missionIds.length;
}

class SharingAcceptanceError extends Error {
  constructor(readonly serviceError: ServiceError) {
    super(serviceError.message);
  }
}

export async function listSharingInvitations(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<SharingInvitation[]> {
  const applicant = await getApplicant(db, applicantId);
  if (applicant?.ownerAccountId !== actorAccountId) return [];
  return db
    .select()
    .from(schema.sharingInvitations)
    .where(eq(schema.sharingInvitations.applicantId, applicantId))
    .orderBy(desc(schema.sharingInvitations.createdAt));
}

/** One case a pending all-cases invitation will not cover once accepted (ADR 0017). */
export interface InvitationCaseException {
  readonly invitationId: string;
  readonly missionId: string;
  readonly missionTitle: string;
  readonly since: Date;
}

/**
 * The case exceptions recorded against this person's sharing invitations,
 * oldest first, for the owner's Sharing page. Owner only (a genuine
 * VIEW_METADATA proof whose actor owns the record); anyone else is refused.
 */
export async function listInvitationCaseExceptions(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<InvitationCaseException[], ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.actor.kind !== 'applicant_owner'
  ) {
    return err(serviceError('forbidden', 'Only the owner of this record can see this.'));
  }
  const exceptions = await listCaseExclusionsForApplicant(proof.tx, proof.applicant.id);
  return ok(
    exceptions.flatMap((e) =>
    e.sharingInvitationId
      ? [
          {
            invitationId: e.sharingInvitationId,
            missionId: e.missionId,
            missionTitle: e.missionTitle,
            since: e.createdAt,
          },
        ]
      : [],
    ),
  );
}

export async function revokeSharingInvitation(
  db: Db,
  actorAccountId: string,
  invitationId: string,
): Promise<Result<void, ServiceError>> {
  return db.transaction(async (tx) => {
    const invite = first(
      await tx
        .select()
        .from(schema.sharingInvitations)
        .where(eq(schema.sharingInvitations.id, invitationId))
        .limit(1),
    );
    const applicant = invite && (await getApplicant(tx, invite.applicantId));
    if (!invite || applicant?.ownerAccountId !== actorAccountId)
      return err(serviceError('forbidden', 'Only the owner can revoke this invitation.'));
    const changed = await tx
      .update(schema.sharingInvitations)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(schema.sharingInvitations.id, invite.id),
          eq(schema.sharingInvitations.status, 'PENDING'),
        ),
      )
      .returning();
    if (!changed.length)
      return err(
        serviceError(
          'invalid',
          'Invitation is no longer pending. Manage accepted access in Sharing.',
        ),
      );
    await appendAuditEvent(tx, {
      eventType: 'SHARING_INVITATION_REVOKED',
      actorAccountId,
      applicantId: invite.applicantId,
      resourceType: 'sharing_invitation',
      resourceId: invite.id,
      method: 'MANUAL',
      result: 'ALLOWED',
    });
    return ok(undefined);
  });
}
