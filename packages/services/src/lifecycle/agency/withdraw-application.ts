import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull } from 'drizzle-orm';
import { agencyAiAvailable } from '../../agency-ai-ready';
import { appendAuditEvent } from '../../audit';
import { type Db, first, required, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
import { type Organization, endMembershipInTx } from '../../organizations';

/**
 * The person who applied to register an agency withdraws the application while it is still
 * waiting for review (lifecycle lane G3).
 *
 * Only an active OWNER member may withdraw, and only while the organization is
 * PENDING_VERIFICATION. The organization moves to CLOSED, the status that already means "no
 * standing on the platform": every access check requires ACTIVE, the screens show it as Closed,
 * and the platform review queue offers review only for PENDING_VERIFICATION. A withdrawn
 * application is therefore indistinguishable from a closed agency in status alone; the audit
 * event ORGANIZATION_APPLICATION_WITHDRAWN is what tells them apart.
 *
 * Every membership ends through `endMembershipInTx`, the same path `setMembershipActive` takes,
 * so each carries its own MEMBERSHIP_DEACTIVATED record and its AI connections end. Team
 * invitations that were never used are revoked, because accepting one does not check the
 * organization's status. Client invitations need no change: they already close for any
 * organization that is neither ACTIVE nor PENDING_VERIFICATION.
 *
 * Race safety: the organization row is locked first, so a concurrent withdrawal waits and then
 * sees CLOSED; `reviewOrganization` updates only a row still PENDING_VERIFICATION, so a review
 * that read the row before this commit cannot reopen it; `setMembershipActive` re-checks under a
 * shared lock on the same row, so no member is switched back on afterwards. Audit metadata holds
 * counts only.
 */
export async function withdrawOrganizationApplication(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<Result<Organization, ServiceError>> {
  return db.transaction(async (tx) => {
    const org = first(
      await tx
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, input.organizationId))
        .for('update'),
    );
    if (!org) return err(serviceError('not_found', 'organization not found'));

    const actor = first(
      await tx
        .select({ role: schema.memberships.role, active: schema.memberships.active })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.organizationId, input.organizationId),
            eq(schema.memberships.accountId, input.actorAccountId),
          ),
        )
        .limit(1),
    );
    if (!actor?.active || actor.role !== 'OWNER') {
      return err(serviceError('forbidden', 'only an owner can withdraw this application'));
    }
    if (org.status !== 'PENDING_VERIFICATION') {
      return err(
        serviceError('invalid', 'only an application waiting for review can be withdrawn'),
      );
    }

    // Every agency AI connection of this organization is locked before anything is audited, so
    // this transaction keeps the documented order (connection rows first, the audit chain last)
    // across the whole loop below, not only for its first member.
    if (await agencyAiAvailable(tx)) {
      await tx
        .select({ id: schema.aiConnections.id })
        .from(schema.aiConnectionAgencies)
        .innerJoin(
          schema.aiConnections,
          eq(schema.aiConnections.id, schema.aiConnectionAgencies.connectionId),
        )
        .where(
          and(
            eq(schema.aiConnectionAgencies.organizationId, input.organizationId),
            isNull(schema.aiConnections.revokedAt),
          ),
        )
        .for('update', { of: schema.aiConnections });
    }

    // The row lock above makes the status check final: no other change can land in between.
    const now = new Date();
    const closed = required(
      first(
        await tx
          .update(schema.organizations)
          .set({ status: 'CLOSED', updatedAt: now })
          .where(eq(schema.organizations.id, input.organizationId))
          .returning(),
      ),
      'organization',
    );

    const activeMemberships = await tx
      .select({
        id: schema.memberships.id,
        accountId: schema.memberships.accountId,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.organizationId, input.organizationId),
          eq(schema.memberships.active, true),
        ),
      )
      .for('update');
    let membershipsEnded = 0;
    for (const membership of activeMemberships) {
      const ended = await endMembershipInTx(tx, {
        actorAccountId: input.actorAccountId,
        organizationId: input.organizationId,
        membershipId: membership.id,
        memberAccountId: membership.accountId,
        targetRole: membership.role,
      });
      if (!ended.ok) throw new Error('a locked membership could not be ended');
      membershipsEnded += 1;
    }

    const revoked = await tx
      .update(schema.organizationInvitations)
      .set({ status: 'REVOKED', revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.organizationInvitations.organizationId, input.organizationId),
          eq(schema.organizationInvitations.status, 'PENDING'),
        ),
      )
      .returning({ id: schema.organizationInvitations.id });

    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_APPLICATION_WITHDRAWN',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: closed.id,
      metadata: { membershipsEnded, invitationsRevoked: revoked.length },
    });
    return ok(closed);
  });
}
