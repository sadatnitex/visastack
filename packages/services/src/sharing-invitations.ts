import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gt } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return err(serviceError('invalid', 'Enter a valid recipient email.'));
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
      });
      return ok(accepted.value.id);
    })
    .catch((error: unknown) => {
      if (error instanceof SharingAcceptanceError) return err(error.serviceError);
      throw error;
    });
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
