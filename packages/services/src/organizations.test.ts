import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { type Db, schema as dbSchema } from './db';
import { createOrganizationInvitation } from './invitations';
import {
  addMembership,
  createOrganization,
  isOrgAdmin,
  listOrgMemberships,
  reviewOrganization,
  setMembershipActive,
  suspendOrganization,
  terminateOrganization,
} from './organizations';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error('provision failed');
  return result.value.id;
}

describe('organizations — verification, membership, and the last-active-owner rule', () => {
  let db: Db;
  let ownerId: string;
  let reviewerId: string;

  beforeEach(async () => {
    db = await freshDb();
    ownerId = await account(db, 'owner@agency.example');
    reviewerId = await account(db, 'reviewer@platform.example');
  });

  it('assigns a complimentary founding offer without self-verifying the organization', async () => {
    const created = await createOrganization(db, { actorAccountId: ownerId, name: 'New agency' });
    if (!isOk(created)) throw new Error('expected organization');
    expect(created.value.status).toBe('PENDING_VERIFICATION');
    const subs = await db.select().from(schema.subscriptions);
    expect(subs).toHaveLength(1);
    const plans = await db.select().from(schema.plans);
    const offer = plans.find((p) => p.id === subs[0]?.planId);
    expect(offer?.key).toBe('agency_founding_access');
    expect(offer?.priceMinorUnits).toBe(0);
    const invitation = await createOrganizationInvitation(db, {
      actorAccountId: ownerId,
      organizationId: created.value.id,
      email: 'new-agency-team@example.com',
      role: 'CASE_MANAGER',
    });
    expect(isOk(invitation)).toBe(true);
    const unchanged = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, created.value.id));
    expect(unchanged[0]?.status).toBe('PENDING_VERIFICATION');
  });

  it('creates an organization PENDING_VERIFICATION with the creator as OWNER', async () => {
    const result = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.status).toBe('PENDING_VERIFICATION');
    expect(await isOrgAdmin(db, ownerId, result.value.id)).toBe(true);
  });

  it('refuses an empty name', async () => {
    const result = await createOrganization(db, { actorAccountId: ownerId, name: '   ' });
    expect(isOk(result)).toBe(false);
  });

  describe('review — independent, step-up gated, one-shot', () => {
    let orgId: string;
    beforeEach(async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      orgId = created.value.id;
    });

    it('refuses to review without step-up', async () => {
      const result = await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: orgId,
        decision: 'ACTIVE',
        stepUpSatisfied: false,
      });
      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;
      expect(result.error.code).toBe('step_up_required');
    });

    it('refuses to let a member of the organization review (verify) it — no self-verification', async () => {
      const result = await reviewOrganization(db, {
        reviewerAccountId: ownerId, // the owner IS a member of their own org
        organizationId: orgId,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;
      expect(result.error.code).toBe('forbidden');
    });

    it('an independent reviewer activates a PENDING_VERIFICATION org with step-up', async () => {
      const result = await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: orgId,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value.status).toBe('ACTIVE');
    });

    it('can reject instead of activate', async () => {
      const result = await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: orgId,
        decision: 'REJECTED',
        stepUpSatisfied: true,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value.status).toBe('REJECTED');
    });

    it('refuses to review an org that is not PENDING_VERIFICATION (no re-review)', async () => {
      await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: orgId,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      const second = await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: orgId,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      expect(isOk(second)).toBe(false);
      if (isOk(second)) return;
      expect(second.error.code).toBe('invalid');
    });

    it('records an audit event for the review decision', async () => {
      await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: orgId,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      const events = await db
        .select()
        .from(dbSchema.auditEvents)
        .where(eq(dbSchema.auditEvents.eventType, 'ORGANIZATION_REVIEWED'));
      expect(events).toHaveLength(1);
      expect(events[0]?.actorAccountId).toBe(reviewerId);
      // Chain-hash correctness itself is covered by services.test.ts; this
      // assertion only needs to prove organizations.ts actually calls the
      // audit sink with the right actor, which the check above already does.
    });
  });

  describe('suspension', () => {
    it('suspends an ACTIVE organization', async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      const suspended = await suspendOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: true,
      });
      expect(isOk(suspended)).toBe(true);
      if (isOk(suspended)) expect(suspended.value.status).toBe('SUSPENDED');
    });

    it('refuses to suspend an org that is not ACTIVE (e.g. still PENDING_VERIFICATION)', async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      const result = await suspendOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: true,
      });
      expect(isOk(result)).toBe(false);
    });

    it('refuses to suspend without step-up', async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      const result = await suspendOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: false,
      });
      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;
      expect(result.error.code).toBe('step_up_required');
    });
  });

  describe('termination (master directive Part 7 §14, PRD PRV-04: "removes agency access")', () => {
    it('terminates an ACTIVE organization', async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      const terminated = await terminateOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: true,
      });
      expect(isOk(terminated)).toBe(true);
      if (isOk(terminated)) expect(terminated.value.status).toBe('CLOSED');
    });

    it('refuses to terminate without step-up', async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      const result = await terminateOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: false,
      });
      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;
      expect(result.error.code).toBe('step_up_required');
    });

    it('terminates a SUSPENDED organization too -- termination is legal from either operating status', async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      await suspendOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: true,
      });
      const terminated = await terminateOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: true,
      });
      expect(isOk(terminated)).toBe(true);
      if (isOk(terminated)) expect(terminated.value.status).toBe('CLOSED');
    });

    it('refuses to terminate an org that never onboarded (still PENDING_VERIFICATION)', async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      const result = await terminateOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: true,
      });
      expect(isOk(result)).toBe(false);
    });

    it('refuses to re-terminate an already-CLOSED organization', async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      await terminateOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: true,
      });
      const second = await terminateOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: true,
      });
      expect(isOk(second)).toBe(false);
    });

    it('records an audit event naming the organization’s status just before termination', async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      await reviewOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      await terminateOrganization(db, {
        reviewerAccountId: reviewerId,
        organizationId: created.value.id,
        stepUpSatisfied: true,
      });
      const events = await db
        .select()
        .from(dbSchema.auditEvents)
        .where(eq(dbSchema.auditEvents.eventType, 'ORGANIZATION_TERMINATED'));
      expect(events).toHaveLength(1);
      expect(events[0]?.actorAccountId).toBe(reviewerId);
      expect(events[0]?.metadata).toMatchObject({ previousStatus: 'ACTIVE' });
    });
  });

  describe('membership and the last-active-owner rule', () => {
    let orgId: string;
    let secondOwnerId: string;
    let staffId: string;

    beforeEach(async () => {
      const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
      if (!isOk(created)) throw new Error('setup failed');
      orgId = created.value.id;
      secondOwnerId = await account(db, 'second-owner@agency.example');
      staffId = await account(db, 'staff@agency.example');
      await addMembership(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        accountId: secondOwnerId,
        role: 'OWNER',
      });
      await addMembership(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        accountId: staffId,
        role: 'CASE_MANAGER',
      });
    });

    it('only an OWNER/ADMIN can add a member', async () => {
      const outsider = await account(db, 'outsider@example.com');
      const result = await addMembership(db, {
        actorAccountId: staffId, // CASE_MANAGER, not OWNER/ADMIN
        organizationId: orgId,
        accountId: outsider,
        role: 'CASE_MANAGER',
      });
      expect(isOk(result)).toBe(false);
    });

    it('deactivates a non-owner membership immediately', async () => {
      const memberships = await listOrgMemberships(db, ownerId, orgId);
      if (!isOk(memberships)) throw new Error('setup failed');
      const staffMembership = memberships.value.find((m) => m.accountId === staffId);
      expect(staffMembership).toBeDefined();

      const result = await setMembershipActive(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        membershipId: staffMembership?.membershipId ?? '',
        active: false,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value.active).toBe(false);
    });

    it('refuses to deactivate the last active owner', async () => {
      // Deactivate the second owner first, leaving exactly one active owner.
      const memberships1 = await listOrgMemberships(db, ownerId, orgId);
      if (!isOk(memberships1)) throw new Error('setup failed');
      const secondOwnerMembership = memberships1.value.find((m) => m.accountId === secondOwnerId);
      const firstOwnerMembership = memberships1.value.find((m) => m.accountId === ownerId);
      expect(secondOwnerMembership).toBeDefined();
      expect(firstOwnerMembership).toBeDefined();

      const deactivateSecond = await setMembershipActive(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        membershipId: secondOwnerMembership?.membershipId ?? '',
        active: false,
      });
      expect(isOk(deactivateSecond)).toBe(true);

      // Now only the first owner is active — deactivating them must be refused.
      const deactivateLast = await setMembershipActive(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        membershipId: firstOwnerMembership?.membershipId ?? '',
        active: false,
      });
      expect(isOk(deactivateLast)).toBe(false);
      if (isOk(deactivateLast)) return;
      expect(deactivateLast.error.code).toBe('invalid');

      // The owner is still active in the database — the refusal was real, not just reported.
      const stillActive = await db
        .select()
        .from(dbSchema.memberships)
        .where(eq(dbSchema.memberships.id, firstOwnerMembership?.membershipId ?? ''));
      expect(stillActive[0]?.active).toBe(true);
    });

    it('two owners deactivating each other concurrently never leaves zero active owners', async () => {
      const memberships = await listOrgMemberships(db, ownerId, orgId);
      if (!isOk(memberships)) throw new Error('setup failed');
      const firstOwnerMembership = memberships.value.find((m) => m.accountId === ownerId);
      const secondOwnerMembership = memberships.value.find((m) => m.accountId === secondOwnerId);

      // Both owners attempt to deactivate the OTHER owner at the same time.
      // Only one may succeed — the row-locking in setMembershipActive must
      // serialize these, not let both independently observe "another owner
      // exists" and both proceed.
      const [resultA, resultB] = await Promise.all([
        setMembershipActive(db, {
          actorAccountId: ownerId,
          organizationId: orgId,
          membershipId: secondOwnerMembership?.membershipId ?? '',
          active: false,
        }),
        setMembershipActive(db, {
          actorAccountId: secondOwnerId,
          organizationId: orgId,
          membershipId: firstOwnerMembership?.membershipId ?? '',
          active: false,
        }),
      ]);

      const succeeded = [resultA, resultB].filter(isOk);
      // At least one must succeed (deactivating a genuinely-not-last owner is
      // legitimate); crucially, the org must never end up with zero active owners.
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
      const activeOwners = await db
        .select()
        .from(dbSchema.memberships)
        .where(eq(dbSchema.memberships.organizationId, orgId));
      const activeOwnerCount = activeOwners.filter((m) => m.role === 'OWNER' && m.active).length;
      expect(activeOwnerCount).toBeGreaterThanOrEqual(1);
    });

    it('cross-tenant IDOR: a membership ID from a different organization is refused, even for an OWNER/ADMIN of the calling org', async () => {
      const otherOwnerId = await account(db, 'other-owner@other-agency.example');
      const otherOrg = await createOrganization(db, {
        actorAccountId: otherOwnerId,
        name: 'Other Agency',
      });
      if (!isOk(otherOrg)) throw new Error('setup failed');
      const otherOrgMemberships = await listOrgMemberships(db, otherOwnerId, otherOrg.value.id);
      if (!isOk(otherOrgMemberships)) throw new Error('setup failed');
      const otherOwnerMembershipId = otherOrgMemberships.value[0]?.membershipId ?? '';

      // ownerId is OWNER of `orgId`, NOT of `otherOrg` — attempting to
      // deactivate the other org's owner membership, scoped to their own
      // orgId, must be refused as not found in THIS organization.
      const result = await setMembershipActive(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        membershipId: otherOwnerMembershipId,
        active: false,
      });
      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;
      expect(result.error.code).toBe('not_found');

      // Confirm the other org's owner membership was untouched.
      const stillActive = await db
        .select()
        .from(dbSchema.memberships)
        .where(eq(dbSchema.memberships.id, otherOwnerMembershipId));
      expect(stillActive[0]?.active).toBe(true);
    });

    it("only an OWNER can change another OWNER's membership — an ADMIN cannot", async () => {
      const adminId = await account(db, 'admin@agency.example');
      await addMembership(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        accountId: adminId,
        role: 'ADMIN',
      });
      const memberships = await listOrgMemberships(db, ownerId, orgId);
      if (!isOk(memberships)) throw new Error('setup failed');
      const secondOwnerMembership = memberships.value.find((m) => m.accountId === secondOwnerId);

      const result = await setMembershipActive(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        membershipId: secondOwnerMembership?.membershipId ?? '',
        active: false,
      });
      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;
      expect(result.error.code).toBe('forbidden');
    });

    it('deactivated membership removes admin standing immediately', async () => {
      const memberships = await listOrgMemberships(db, ownerId, orgId);
      if (!isOk(memberships)) throw new Error('setup failed');
      const staffMembership = memberships.value.find((m) => m.accountId === staffId);
      expect(await isOrgAdmin(db, staffId, orgId)).toBe(false); // CASE_MANAGER was never admin

      // Promote staff to ADMIN, confirm, then deactivate and confirm it's gone.
      await db
        .update(dbSchema.memberships)
        .set({ role: 'ADMIN' })
        .where(eq(dbSchema.memberships.id, staffMembership?.membershipId ?? ''));
      expect(await isOrgAdmin(db, staffId, orgId)).toBe(true);

      await setMembershipActive(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        membershipId: staffMembership?.membershipId ?? '',
        active: false,
      });
      expect(await isOrgAdmin(db, staffId, orgId)).toBe(false);
    });
  });
});
