import type { MembershipRole } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Organizations (agencies) — verification and membership (Build Spec §2;
 * PRD §5).
 *
 * An organization is created PENDING_VERIFICATION and cannot upgrade itself:
 * activation is an independent review (the reviewer must not be a member of the
 * org). Membership roles never grant resource access — that is always a grant
 * (see sharing.ts / the policy engine).
 */

export type Organization = typeof schema.organizations.$inferSelect;
export type Membership = typeof schema.memberships.$inferSelect;

/** True if the account is an active OWNER/ADMIN of the organization. */
export async function isOrgAdmin(
  db: Db,
  accountId: string,
  organizationId: string,
): Promise<boolean> {
  const m = first(
    await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
  return m?.active === true && (m.role === 'OWNER' || m.role === 'ADMIN');
}

async function isMember(db: Db, accountId: string, organizationId: string): Promise<boolean> {
  const m = first(
    await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
  return m !== undefined;
}

/** An organization the account belongs to, with the account's role/active flag. */
export interface OrgMembershipView {
  readonly organization: Organization;
  readonly membershipId: string;
  readonly role: MembershipRole;
  readonly active: boolean;
}

/** Every organization the account is a member of, with its membership. */
export async function listMembershipsForAccount(
  db: Db,
  accountId: string,
): Promise<OrgMembershipView[]> {
  const rows = await db
    .select({
      organization: schema.organizations,
      membershipId: schema.memberships.id,
      role: schema.memberships.role,
      active: schema.memberships.active,
    })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.accountId, accountId));
  return rows.map((row) => ({
    organization: row.organization,
    membershipId: row.membershipId,
    role: row.role,
    active: row.active,
  }));
}

/** Load one organization by id (no scoping — callers enforce membership). */
export async function getOrganization(
  db: Db,
  organizationId: string,
): Promise<Organization | undefined> {
  return first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  );
}

/** Every organization (platform-admin overview), newest first. */
export async function listAllOrganizations(db: Db): Promise<Organization[]> {
  const rows = await db.select().from(schema.organizations);
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Create an organization (PENDING_VERIFICATION) with the creator as OWNER. */
export async function createOrganization(
  db: Db,
  input: { readonly actorAccountId: string; readonly name: string },
): Promise<Result<Organization, ServiceError>> {
  if (input.name.trim().length === 0) return err(serviceError('invalid', 'a name is required'));
  return db.transaction(async (tx) => {
    const org = required(
      first(await tx.insert(schema.organizations).values({ name: input.name.trim() }).returning()),
      'organization',
    );
    await tx.insert(schema.memberships).values({
      accountId: input.actorAccountId,
      organizationId: org.id,
      role: 'OWNER',
    });
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: org.id,
    });
    return ok(org);
  });
}

/**
 * Review a PENDING_VERIFICATION organization (platform-admin action). The
 * reviewer must NOT be a member — an org can never verify itself (Build Spec §2).
 */
export async function reviewOrganization(
  db: Db,
  input: {
    readonly reviewerAccountId: string;
    readonly organizationId: string;
    readonly decision: 'ACTIVE' | 'REJECTED';
  },
): Promise<Result<Organization, ServiceError>> {
  const org = first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));
  if (org.status !== 'PENDING_VERIFICATION') {
    return err(serviceError('invalid', 'only a PENDING_VERIFICATION org can be reviewed'));
  }
  if (await isMember(db, input.reviewerAccountId, input.organizationId)) {
    return err(serviceError('forbidden', 'an organization cannot verify itself'));
  }
  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.organizations)
          .set({ status: input.decision, updatedAt: new Date() })
          .where(eq(schema.organizations.id, input.organizationId))
          .returning(),
      ),
      'organization',
    );
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_REVIEWED',
      actorAccountId: input.reviewerAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: updated.id,
      metadata: { decision: input.decision },
    });
    return ok(updated);
  });
}

/** Suspend an ACTIVE organization (platform-admin action). */
export async function suspendOrganization(
  db: Db,
  input: { readonly reviewerAccountId: string; readonly organizationId: string },
): Promise<Result<Organization, ServiceError>> {
  const org = first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));
  if (org.status !== 'ACTIVE')
    return err(serviceError('invalid', 'only an ACTIVE org can be suspended'));
  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.organizations)
          .set({ status: 'SUSPENDED', updatedAt: new Date() })
          .where(eq(schema.organizations.id, input.organizationId))
          .returning(),
      ),
      'organization',
    );
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_SUSPENDED',
      actorAccountId: input.reviewerAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: updated.id,
    });
    return ok(updated);
  });
}

/** Add a member to an organization (OWNER/ADMIN only). */
export async function addMembership(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly accountId: string;
    readonly role: MembershipRole;
  },
): Promise<Result<Membership, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can add members'));
  }
  return db.transaction(async (tx) => {
    const membership = required(
      first(
        await tx
          .insert(schema.memberships)
          .values({
            accountId: input.accountId,
            organizationId: input.organizationId,
            role: input.role,
          })
          .returning(),
      ),
      'membership',
    );
    await appendAuditEvent(tx, {
      eventType: 'MEMBERSHIP_ADDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'membership',
      resourceId: membership.id,
      metadata: { organizationId: input.organizationId, role: input.role },
    });
    return ok(membership);
  });
}

/** Activate/deactivate a membership (OWNER/ADMIN only). Deactivation ends access. */
export async function setMembershipActive(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly membershipId: string;
    readonly active: boolean;
  },
): Promise<Result<Membership, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can change memberships'));
  }
  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.memberships)
          .set({ active: input.active, updatedAt: new Date() })
          .where(eq(schema.memberships.id, input.membershipId))
          .returning(),
      ),
      'membership',
    );
    await appendAuditEvent(tx, {
      eventType: input.active ? 'MEMBERSHIP_ACTIVATED' : 'MEMBERSHIP_DEACTIVATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'membership',
      resourceId: updated.id,
    });
    return ok(updated);
  });
}
