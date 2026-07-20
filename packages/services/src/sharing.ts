import type { PermissionAction } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, eq } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Sharing — scoped, accepted, time-limited grants (Build Spec §4.4; PRD §5).
 *
 * A grant is the ONLY way access crosses tenants. The applicant owner creates
 * it (purpose-bound, action-scoped, optionally mission/category-scoped and time
 * limited); it takes effect only once the recipient accepts, and is revocable
 * at any time. The policy engine consumes these rows; this service manages
 * their lifecycle and gives the owner full access transparency.
 */

export type Grant = typeof schema.grants.$inferSelect;

async function ownsApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<boolean> {
  const applicant = await getApplicant(db, applicantId);
  return applicant !== undefined && applicant.ownerAccountId === actorAccountId;
}

export interface CreateGrantInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly recipientAccountId?: string;
  readonly recipientOrganizationId?: string;
  readonly actions: readonly PermissionAction[];
  readonly purpose: string;
  readonly categories?: readonly string[];
  readonly missionId?: string;
  readonly expiryAt?: Date;
}

/** Create a pending, purpose-bound grant (applicant owner only). */
export async function createGrant(
  db: Db,
  input: CreateGrantInput,
): Promise<Result<Grant, ServiceError>> {
  if (!(await ownsApplicant(db, input.actorAccountId, input.applicantId))) {
    return err(serviceError('forbidden', 'only the applicant owner can grant access'));
  }
  if (!input.recipientAccountId && !input.recipientOrganizationId) {
    return err(serviceError('invalid', 'a grant must name a recipient'));
  }
  if (input.actions.length === 0)
    return err(serviceError('invalid', 'a grant needs at least one action'));
  if (input.purpose.trim().length === 0)
    return err(serviceError('invalid', 'a purpose is required'));

  return db.transaction(async (tx) => {
    const grant = required(
      first(
        await tx
          .insert(schema.grants)
          .values({
            applicantId: input.applicantId,
            recipientAccountId: input.recipientAccountId ?? null,
            recipientOrganizationId: input.recipientOrganizationId ?? null,
            missionId: input.missionId ?? null,
            actions: [...input.actions],
            categories: input.categories ? [...input.categories] : null,
            purpose: input.purpose.trim(),
            expiryAt: input.expiryAt ?? null,
          })
          .returning(),
      ),
      'grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'GRANT_CREATED',
      actorAccountId: input.actorAccountId,
      action: 'SHARE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
      metadata: { purpose: grant.purpose, actions: input.actions.length },
    });
    return ok(grant);
  });
}

async function loadGrant(db: Db, grantId: string): Promise<Grant | undefined> {
  return first(await db.select().from(schema.grants).where(eq(schema.grants.id, grantId)).limit(1));
}

/** Accept a pending grant. The actor must be the named recipient. */
export async function acceptGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  const grant = await loadGrant(db, input.grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (grant.status !== 'PENDING_ACCEPTANCE') {
    return err(serviceError('invalid', 'grant is not pending acceptance'));
  }

  const isRecipientAccount = grant.recipientAccountId === input.actorAccountId;
  let isRecipientOrgMember = false;
  if (grant.recipientOrganizationId) {
    const m = first(
      await db
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.accountId, input.actorAccountId),
            eq(schema.memberships.organizationId, grant.recipientOrganizationId),
          ),
        )
        .limit(1),
    );
    isRecipientOrgMember = m?.active === true;
  }
  if (!isRecipientAccount && !isRecipientOrgMember) {
    return err(serviceError('forbidden', 'only the grant recipient can accept it'));
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.grants)
          .set({ status: 'ACTIVE', acceptedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.grants.id, input.grantId))
          .returning(),
      ),
      'grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'GRANT_ACCEPTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: grant.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
    });
    return ok(updated);
  });
}

async function ownerTransition(
  db: Db,
  actorAccountId: string,
  grantId: string,
  to: Grant['status'],
  eventType: string,
): Promise<Result<Grant, ServiceError>> {
  const grant = await loadGrant(db, grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (!(await ownsApplicant(db, actorAccountId, grant.applicantId))) {
    return err(serviceError('forbidden', 'only the applicant owner can change this grant'));
  }
  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.grants)
          .set({ status: to, updatedAt: new Date() })
          .where(eq(schema.grants.id, grantId))
          .returning(),
      ),
      'grant',
    );
    await appendAuditEvent(tx, {
      eventType,
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: grant.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
    });
    return ok(updated);
  });
}

/** Revoke a grant (applicant owner). Access ends on the next request. */
export function revokeGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  return ownerTransition(db, input.actorAccountId, input.grantId, 'REVOKED', 'GRANT_REVOKED');
}

/** Pause a grant (applicant owner). */
export function pauseGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  return ownerTransition(db, input.actorAccountId, input.grantId, 'PAUSED', 'GRANT_PAUSED');
}

/** Resume a paused grant (applicant owner). */
export function resumeGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  return ownerTransition(db, input.actorAccountId, input.grantId, 'ACTIVE', 'GRANT_RESUMED');
}

/** Access transparency: every grant on an applicant (owner only). */
export async function listAccessForApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<Grant[], ServiceError>> {
  if (!(await ownsApplicant(db, actorAccountId, applicantId))) {
    return err(serviceError('forbidden', 'not authorized to view access for this applicant'));
  }
  const rows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  return ok(rows);
}
