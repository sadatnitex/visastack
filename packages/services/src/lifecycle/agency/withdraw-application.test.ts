import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from '../../accounts';
import type { Db } from '../../db';
import { createOrganizationInvitation } from '../../invitations';
import {
  addMembership,
  createOrganization,
  isOrgAdmin,
  listAllOrganizations,
  reviewOrganization,
  setMembershipActive,
  suspendOrganization,
  terminateOrganization,
  withdrawOrganizationApplication,
} from '../../organizations';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error('provision failed');
  return result.value.id;
}

async function pendingOrg(db: Db, ownerId: string): Promise<string> {
  const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Harbour Visas' });
  if (!isOk(created)) throw new Error('expected organization');
  return created.value.id;
}

async function statusOf(db: Db, organizationId: string): Promise<string | undefined> {
  const rows = await db
    .select({ status: schema.organizations.status })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId));
  return rows[0]?.status;
}

async function auditOf(db: Db, eventType: string) {
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, eventType));
}

describe('withdrawOrganizationApplication', () => {
  let db: Db;
  let ownerId: string;

  beforeEach(async () => {
    db = await freshDb();
    ownerId = await account(db, 'owner@agency.example');
  });

  it('closes a pending application, ends every membership and records the withdrawal', async () => {
    const orgId = await pendingOrg(db, ownerId);
    const adminId = await account(db, 'admin@agency.example');
    const added = await addMembership(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
      accountId: adminId,
      role: 'ADMIN',
    });
    expect(isOk(added)).toBe(true);

    const result = await withdrawOrganizationApplication(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.status).toBe('CLOSED');
    expect(await statusOf(db, orgId)).toBe('CLOSED');

    const memberships = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.organizationId, orgId));
    expect(memberships).toHaveLength(2);
    expect(memberships.every((m) => m.active === false)).toBe(true);
    expect(await isOrgAdmin(db, ownerId, orgId)).toBe(false);

    // Each membership ends through the normal path, so it carries its own record.
    const ended = await auditOf(db, 'MEMBERSHIP_DEACTIVATED');
    expect(ended).toHaveLength(2);

    const withdrawn = await auditOf(db, 'ORGANIZATION_APPLICATION_WITHDRAWN');
    expect(withdrawn).toHaveLength(1);
    const event = withdrawn[0];
    expect(event?.actorAccountId).toBe(ownerId);
    expect(event?.resourceType).toBe('organization');
    expect(event?.resourceId).toBe(orgId);
    expect(event?.result).toBe('ALLOWED');
    // Ids and counts only: the agency name never enters the record.
    expect(JSON.stringify(event?.metadata ?? {})).not.toContain('Harbour');
    expect(event?.metadata).toMatchObject({ membershipsEnded: 2, invitationsRevoked: 0 });
  });

  it('revokes team invitations that were never used', async () => {
    const orgId = await pendingOrg(db, ownerId);
    const invited = await createOrganizationInvitation(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
      email: 'case-manager@agency.example',
      role: 'CASE_MANAGER',
    });
    expect(isOk(invited)).toBe(true);

    const result = await withdrawOrganizationApplication(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
    });
    expect(isOk(result)).toBe(true);
    const open = await db
      .select()
      .from(schema.organizationInvitations)
      .where(
        and(
          eq(schema.organizationInvitations.organizationId, orgId),
          eq(schema.organizationInvitations.status, 'PENDING'),
        ),
      );
    expect(open).toHaveLength(0);
    const withdrawn = await auditOf(db, 'ORGANIZATION_APPLICATION_WITHDRAWN');
    expect(withdrawn[0]?.metadata).toMatchObject({ invitationsRevoked: 1 });
  });

  it('refuses another account, changes nothing and records nothing', async () => {
    const orgId = await pendingOrg(db, ownerId);
    const strangerId = await account(db, 'stranger@elsewhere.example');
    const result = await withdrawOrganizationApplication(db, {
      actorAccountId: strangerId,
      organizationId: orgId,
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.code).toBe('forbidden');
    expect(await statusOf(db, orgId)).toBe('PENDING_VERIFICATION');
    expect(await isOrgAdmin(db, ownerId, orgId)).toBe(true);
    expect(await auditOf(db, 'ORGANIZATION_APPLICATION_WITHDRAWN')).toHaveLength(0);
  });

  it('refuses a member who is not an owner, even an admin', async () => {
    const orgId = await pendingOrg(db, ownerId);
    const adminId = await account(db, 'admin@agency.example');
    await addMembership(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
      accountId: adminId,
      role: 'ADMIN',
    });
    const result = await withdrawOrganizationApplication(db, {
      actorAccountId: adminId,
      organizationId: orgId,
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.code).toBe('forbidden');
    expect(await statusOf(db, orgId)).toBe('PENDING_VERIFICATION');
  });

  it('refuses an owner whose membership has already ended', async () => {
    const orgId = await pendingOrg(db, ownerId);
    await db
      .update(schema.memberships)
      .set({ active: false })
      .where(
        and(
          eq(schema.memberships.organizationId, orgId),
          eq(schema.memberships.accountId, ownerId),
        ),
      );
    const result = await withdrawOrganizationApplication(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.code).toBe('forbidden');
    expect(await statusOf(db, orgId)).toBe('PENDING_VERIFICATION');
  });

  it('refuses an unknown organization', async () => {
    const result = await withdrawOrganizationApplication(db, {
      actorAccountId: ownerId,
      organizationId: '00000000-0000-4000-8000-000000000000',
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.code).toBe('not_found');
  });

  it('works only while the application is waiting for review', async () => {
    const reviewerId = await account(db, 'reviewer@platform.example');

    const approvedId = await pendingOrg(db, ownerId);
    await reviewOrganization(db, {
      reviewerAccountId: reviewerId,
      organizationId: approvedId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const rejectedId = await pendingOrg(db, ownerId);
    await reviewOrganization(db, {
      reviewerAccountId: reviewerId,
      organizationId: rejectedId,
      decision: 'REJECTED',
      stepUpSatisfied: true,
    });
    const suspendedId = await pendingOrg(db, ownerId);
    await reviewOrganization(db, {
      reviewerAccountId: reviewerId,
      organizationId: suspendedId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    await suspendOrganization(db, {
      reviewerAccountId: reviewerId,
      organizationId: suspendedId,
      stepUpSatisfied: true,
    });
    const terminatedId = await pendingOrg(db, ownerId);
    await reviewOrganization(db, {
      reviewerAccountId: reviewerId,
      organizationId: terminatedId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    await terminateOrganization(db, {
      reviewerAccountId: reviewerId,
      organizationId: terminatedId,
      stepUpSatisfied: true,
    });

    const expected: Array<[string, string]> = [
      [approvedId, 'ACTIVE'],
      [rejectedId, 'REJECTED'],
      [suspendedId, 'SUSPENDED'],
      [terminatedId, 'CLOSED'],
    ];
    for (const [orgId, status] of expected) {
      const result = await withdrawOrganizationApplication(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
      });
      expect(isOk(result)).toBe(false);
      if (isOk(result)) continue;
      expect(result.error.code).toBe('invalid');
      expect(await statusOf(db, orgId)).toBe(status);
    }
    expect(await auditOf(db, 'ORGANIZATION_APPLICATION_WITHDRAWN')).toHaveLength(0);
  });

  it('cannot be withdrawn twice', async () => {
    const orgId = await pendingOrg(db, ownerId);
    const first = await withdrawOrganizationApplication(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
    });
    expect(isOk(first)).toBe(true);
    const second = await withdrawOrganizationApplication(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
    });
    expect(isOk(second)).toBe(false);
    expect(await auditOf(db, 'ORGANIZATION_APPLICATION_WITHDRAWN')).toHaveLength(1);
  });

  it('leaves the platform review queue: a withdrawn application can no longer be reviewed', async () => {
    const orgId = await pendingOrg(db, ownerId);
    const reviewerId = await account(db, 'reviewer@platform.example');
    await withdrawOrganizationApplication(db, { actorAccountId: ownerId, organizationId: orgId });

    const all = await listAllOrganizations(db);
    const pending = all.filter((org) => org.status === 'PENDING_VERIFICATION');
    expect(pending.map((org) => org.id)).not.toContain(orgId);

    const review = await reviewOrganization(db, {
      reviewerAccountId: reviewerId,
      organizationId: orgId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    expect(isOk(review)).toBe(false);
    expect(await statusOf(db, orgId)).toBe('CLOSED');
  });

  it('leaves other organizations of the same owner untouched', async () => {
    const withdrawnId = await pendingOrg(db, ownerId);
    const otherId = await pendingOrg(db, ownerId);
    await withdrawOrganizationApplication(db, {
      actorAccountId: ownerId,
      organizationId: withdrawnId,
    });
    expect(await statusOf(db, otherId)).toBe('PENDING_VERIFICATION');
    expect(await isOrgAdmin(db, ownerId, otherId)).toBe(true);
  });

  it('works on a database without the lifecycle tables (it never reads them)', async () => {
    // The migrated test database may already hold them: remove them, as before the migration runs.
    for (const table of [
      'document_lifecycle',
      'applicant_lifecycle',
      'document_removal_requests',
      'deletion_receipts',
    ]) {
      await db.execute(sql.raw(`drop table if exists ${table} cascade`));
    }
    const present = await db.execute(
      sql`select to_regclass('public.document_lifecycle') is not null as present`,
    );
    const rows = (present as unknown as { rows: Array<{ present: boolean }> }).rows;
    expect(rows[0]?.present).toBe(false);
    const orgId = await pendingOrg(db, ownerId);
    const result = await withdrawOrganizationApplication(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
    });
    expect(isOk(result)).toBe(true);
  });

  it('works the same once the lifecycle tables exist', async () => {
    for (const table of [
      'document_lifecycle',
      'applicant_lifecycle',
      'document_removal_requests',
      'deletion_receipts',
    ]) {
      await db.execute(sql.raw(`create table if not exists ${table} (id uuid)`));
    }
    const orgId = await pendingOrg(db, ownerId);
    const result = await withdrawOrganizationApplication(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
    });
    expect(isOk(result)).toBe(true);
    expect(await statusOf(db, orgId)).toBe('CLOSED');
  });

  it('a review that read the application before it was withdrawn cannot reopen it', async () => {
    const orgId = await pendingOrg(db, ownerId);
    const reviewerId = await account(db, 'reviewer@platform.example');
    // The withdrawal commits between the review's own read and its write.
    const racing = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (run: Parameters<Db['transaction']>[0]) => {
            const withdrawn = await withdrawOrganizationApplication(target, {
              actorAccountId: ownerId,
              organizationId: orgId,
            });
            expect(isOk(withdrawn)).toBe(true);
            return target.transaction(run);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const review = await reviewOrganization(racing, {
      reviewerAccountId: reviewerId,
      organizationId: orgId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    expect(isOk(review)).toBe(false);
    expect(await statusOf(db, orgId)).toBe('CLOSED');
    expect(await auditOf(db, 'ORGANIZATION_REVIEWED')).toHaveLength(0);
  });

  it('an admin who passed the role check before the withdrawal cannot switch a member back on', async () => {
    const orgId = await pendingOrg(db, ownerId);
    const adminId = await account(db, 'admin@agency.example');
    const memberId = await account(db, 'member@agency.example');
    await addMembership(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
      accountId: adminId,
      role: 'ADMIN',
    });
    const member = await addMembership(db, {
      actorAccountId: ownerId,
      organizationId: orgId,
      accountId: memberId,
      role: 'CASE_MANAGER',
    });
    if (!isOk(member)) throw new Error('expected membership');
    await setMembershipActive(db, {
      actorAccountId: adminId,
      organizationId: orgId,
      membershipId: member.value.id,
      active: false,
    });
    // The withdrawal commits between the admin's checks and the admin's write.
    const racing = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (run: Parameters<Db['transaction']>[0]) => {
            const withdrawn = await withdrawOrganizationApplication(target, {
              actorAccountId: ownerId,
              organizationId: orgId,
            });
            expect(isOk(withdrawn)).toBe(true);
            return target.transaction(run);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const reactivated = await setMembershipActive(racing, {
      actorAccountId: adminId,
      organizationId: orgId,
      membershipId: member.value.id,
      active: true,
    });
    expect(isOk(reactivated)).toBe(false);
    const active = await db
      .select()
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.organizationId, orgId), eq(schema.memberships.active, true)),
      );
    expect(active).toHaveLength(0);
  });
});
