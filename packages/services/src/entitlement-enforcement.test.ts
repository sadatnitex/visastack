import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { openBillingAccount, transitionBillingStatus } from './billing';
import { grantCommercialOverride, revokeCommercialOverride } from './commercial-override';
import { setConsent } from './consent';
import type { Db } from './db';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { acceptOrganizationInvitation, createOrganizationInvitation } from './invitations';
import { createMission } from './missions';
import {
  addMembership,
  createOrganization,
  reviewOrganization,
  setMembershipActive,
} from './organizations';
import { activateSubscription, createPlan } from './plans';
import { grantPlatformRole } from './platform-roles';
import type { UploadQuotaConfig } from './quotas';
import { acceptGrant, createGrant } from './sharing';
import { reserveUpload } from './uploads';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

/** A bootstrapped platform owner, the actor every admin-gated plans.ts function needs. */
async function seedPlatformOwner(db: Db, tag: string) {
  const p = await provisionAccount(db, { email: `owner-${tag}@platform.example.com` });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  const granted = await grantPlatformRole(db, {
    actor: { accountId: account.id, email: account.email, bootstrapEmails: [account.email] },
    targetAccountId: account.id,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  return {
    accountId: account.id,
    actor: { accountId: account.id, email: account.email, bootstrapEmails: [] as string[] },
  };
}

/** A verified organization with one OWNER member, ready to receive a subscription. */
async function seedOrganization(db: Db, tag: string, founding = false) {
  const ownerAcc = await provisionAccount(db, { email: `org-owner-${tag}@acme.com` });
  if (!isOk(ownerAcc)) throw new Error('provision');
  const org = await createOrganization(db, {
    actorAccountId: ownerAcc.value.id,
    name: `Acme ${tag}`,
  });
  if (!isOk(org)) throw new Error('org');
  await activateOrg(db, org.value.id);
  // Legacy no-plan fixtures stay distinct from newly assigned founding offers.
  if (!founding) {
    await db
      .update(schema.subscriptions)
      .set({ endedAt: new Date() })
      .where(eq(schema.subscriptions.organizationId, org.value.id));
  }
  return { organizationId: org.value.id, ownerAccountId: ownerAcc.value.id };
}

let planCounter = 0;
/** A plan with deliberately tight, test-chosen entitlement numbers -- never the real seeded catalog figures, which are far too large to hit within a fast boundary test. */
async function createTightPlan(
  db: Db,
  owner: Awaited<ReturnType<typeof seedPlatformOwner>>,
  entitlements: {
    readonly seatsAllowed?: number | null;
    readonly casesPerPeriodAllowed?: number | null;
    readonly concurrentOpenCasesAllowed?: number | null;
    readonly storageBytesAllowed?: number | null;
    readonly periodDays?: number;
  },
) {
  planCounter += 1;
  const created = await createPlan(db, {
    actor: owner.actor,
    stepUpSatisfied: true,
    key: `test-plan-${planCounter}`,
    name: `Test Plan ${planCounter}`,
    ...entitlements,
  });
  if (!isOk(created)) throw new Error('plan');
  return created.value;
}

async function seedTraveller(db: Db, tag: string) {
  const account = await provisionAccount(db, { email: `traveller-${tag}@example.com` });
  if (!isOk(account)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: account.value.id,
    accountId: account.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.value.id,
    ownerAccountId: account.value.id,
    displayName: `Traveller ${tag}`,
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId: account.value.id, applicantId: applicant.value.id };
}

/** Grants an organization real, active, accepted access to an applicant -- the exact precondition `checkStorageEntitlement` looks for. */
async function grantOrgAccessToApplicant(
  db: Db,
  input: {
    readonly applicantOwnerAccountId: string;
    readonly applicantId: string;
    readonly organizationId: string;
    readonly orgOwnerAccountId: string;
  },
): Promise<void> {
  await setConsent(db, {
    actorAccountId: input.applicantOwnerAccountId,
    accountId: input.applicantOwnerAccountId,
    type: 'SHARING',
    granted: true,
  });
  const created = await createGrant(db, {
    actorAccountId: input.applicantOwnerAccountId,
    applicantId: input.applicantId,
    recipientOrganizationId: input.organizationId,
    actions: ['VIEW_METADATA'],
    purpose: 'entitlement-enforcement test access',
  });
  if (!isOk(created)) throw new Error('grant');
  const accepted = await acceptGrant(db, {
    actorAccountId: input.orgOwnerAccountId,
    grantId: created.value.id,
  });
  if (!isOk(accepted)) throw new Error('accept');
}

const MB = 1024 * 1024;
/** Generous infrastructure-tier limits so the four pre-existing byte tiers never trigger -- isolates the new fifth, org-scoped tier under test. */
const generousUploadConfig: UploadQuotaConfig = {
  maxUploadBytes: 100 * MB,
  maxApplicantEvidenceBytes: 100 * MB,
  maxAccountEvidenceBytes: 100 * MB,
  platformWarningBytes: 900 * MB,
  platformHardStopBytes: 1000 * MB,
  maxPdfPages: 50,
  maxImageMegapixels: 40,
};

describe('checkSeatEntitlement / checkInvitationEntitlement - seats (COM-02)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'seats');
  });

  it('allows adding a member when no plan has ever been assigned to the organization (unlimited)', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'noplan');
    const newMember = await provisionAccount(db, { email: 'm-noplan@acme.com' });
    if (!isOk(newMember)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: newMember.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(added)).toBe(true);
  });

  it('allows adding a member when the assigned plan leaves seatsAllowed null (unlimited)', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'nullseats');
    const plan = await createTightPlan(db, owner, { seatsAllowed: null });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const newMember = await provisionAccount(db, { email: 'm-nullseats@acme.com' });
    if (!isOk(newMember)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: newMember.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(added)).toBe(true);
  });

  it('addMembership succeeds right up to the cap, then blocks the one that would exceed it', async () => {
    // seedOrganization already lands 1 active seat (the founding OWNER).
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'cap');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 2 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });

    const second = await provisionAccount(db, { email: 'm2-cap@acme.com' });
    if (!isOk(second)) throw new Error('provision');
    const addedSecond = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: second.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(addedSecond)).toBe(true);

    const third = await provisionAccount(db, { email: 'm3-cap@acme.com' });
    if (!isOk(third)) throw new Error('provision');
    const addedThird = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: third.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isErr(addedThird)).toBe(true);
    if (isErr(addedThird)) expect(addedThird.error.message).toContain('seat');
  });

  it('setMembershipActive refuses to reactivate a deactivated member once the cap is reached, but deactivation itself is never blocked', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'reactivate');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 2 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const member = await provisionAccount(db, { email: 'm-reactivate@acme.com' });
    if (!isOk(member)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: member.value.id,
      role: 'CASE_MANAGER',
    });
    if (!isOk(added)) throw new Error('add');

    // A third member cannot be added -- at cap (owner + member = 2).
    const third = await provisionAccount(db, { email: 'm3-reactivate@acme.com' });
    if (!isOk(third)) throw new Error('provision');
    const addedThird = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: third.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isErr(addedThird)).toBe(true);

    // Deactivating the member is never blocked, even though it's the only
    // way to free a seat -- deactivation only ever frees capacity.
    const deactivated = await setMembershipActive(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      membershipId: added.value.id,
      active: false,
    });
    expect(isOk(deactivated)).toBe(true);

    // Re-add the third member now that a seat is free.
    const addedThirdRetry = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: third.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(addedThirdRetry)).toBe(true);

    // Now at cap again (owner + third = 2) -- reactivating the deactivated
    // member is correctly refused.
    const reactivated = await setMembershipActive(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      membershipId: added.value.id,
      active: true,
    });
    expect(isErr(reactivated)).toBe(true);
    if (isErr(reactivated)) expect(reactivated.error.message).toContain('seat');
  });

  it('setMembershipActive re-activating an ALREADY-active membership is a no-op, never blocked even at cap', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'noop-reactivate');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 1 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const ownerMembership = (
      await db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.organizationId, organizationId))
    )[0];
    if (!ownerMembership) throw new Error('membership');

    // Already at cap (seatsAllowed: 1, one active owner) -- redundantly
    // "activating" the already-active owner must still succeed.
    const redundant = await setMembershipActive(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      membershipId: ownerMembership.id,
      active: true,
    });
    expect(isOk(redundant)).toBe(true);
  });

  it('acceptOrganizationInvitation is blocked once the cap is reached', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'invite-cap');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 1 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    // Minting the invitation itself is refused too (checkInvitationEntitlement),
    // since active seats (1) already equal the cap (1) -- see the
    // createOrganizationInvitation describe block below for that check in
    // isolation. Bypass it here to prove acceptOrganizationInvitation's OWN
    // independent check also holds, by inserting a PENDING invitation
    // directly rather than going through the (also-gating) creation path.
    const invitee = await provisionAccount(db, { email: 'invitee-cap@example.com' });
    if (!isOk(invitee)) throw new Error('provision');
    const rawToken = generateInvitationToken();
    await db.insert(schema.organizationInvitations).values({
      organizationId,
      email: invitee.value.email,
      role: 'CASE_MANAGER',
      tokenHash: hashInvitationToken(rawToken),
      invitedByAccountId: ownerAccountId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const accepted = await acceptOrganizationInvitation(db, {
      actorAccountId: invitee.value.id,
      actorEmail: invitee.value.email,
      rawToken,
    });
    expect(isErr(accepted)).toBe(true);
    if (isErr(accepted)) expect(accepted.error.message).toContain('seat');
  });

  it('acceptOrganizationInvitation re-confirming an already-active membership succeeds even at cap', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'invite-reconfirm');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 2 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const invitee = await provisionAccount(db, { email: 'invitee-reconfirm@example.com' });
    if (!isOk(invitee)) throw new Error('provision');
    // Directly land an ALREADY-ACTIVE membership, as if an earlier
    // invitation had already been accepted -- now at cap (owner + invitee
    // = 2).
    await db.insert(schema.memberships).values({
      accountId: invitee.value.id,
      organizationId,
      role: 'CASE_MANAGER',
    });

    // A fresh PENDING invitation for the SAME (org, email), inserted
    // directly rather than via createOrganizationInvitation -- that
    // function would itself refuse this one ("already has an account; use
    // addMembership instead"), since re-inviting someone who already has an
    // account is not the reachable real path here. This isolates
    // acceptOrganizationInvitation's own re-confirmation branch (its
    // onConflictDoUpdate on the membership insert) specifically, the same
    // direct-insert technique the "is blocked once the cap is reached" test
    // above already uses for the same reason.
    const rawToken = generateInvitationToken();
    await db.insert(schema.organizationInvitations).values({
      organizationId,
      email: invitee.value.email,
      role: 'ADMIN',
      tokenHash: hashInvitationToken(rawToken),
      invitedByAccountId: ownerAccountId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const accepted = await acceptOrganizationInvitation(db, {
      actorAccountId: invitee.value.id,
      actorEmail: invitee.value.email,
      rawToken,
    });
    expect(isOk(accepted)).toBe(true);
  });

  it('under real concurrency, two simultaneous addMembership calls for the last remaining seat never both succeed', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'race');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 2 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const m1 = await provisionAccount(db, { email: 'race1@acme.com' });
    const m2 = await provisionAccount(db, { email: 'race2@acme.com' });
    if (!isOk(m1) || !isOk(m2)) throw new Error('provision');

    const [a, b] = await Promise.all([
      addMembership(db, {
        actorAccountId: ownerAccountId,
        organizationId,
        accountId: m1.value.id,
        role: 'CASE_MANAGER',
      }),
      addMembership(db, {
        actorAccountId: ownerAccountId,
        organizationId,
        accountId: m2.value.id,
        role: 'CASE_MANAGER',
      }),
    ]);
    const results = [a, b];
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(1);

    const activeCount = (
      await db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.organizationId, organizationId))
    ).filter((m) => m.active).length;
    expect(activeCount).toBe(2);
  });
});

describe('checkInvitationEntitlement - invitation minting (COM-02)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'invites');
  });

  it('refuses to mint a new invitation once active seats plus pending invitations already reach the cap', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'mint-cap');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 1 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    // Already at cap: 1 active seat (the owner), seatsAllowed: 1.
    const invited = await createOrganizationInvitation(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      email: 'blocked@example.com',
      role: 'CASE_MANAGER',
    });
    expect(isErr(invited)).toBe(true);
    if (isErr(invited)) expect(invited.error.message).toContain('seat');
  });

  it('re-inviting the same email (superseding a stale pending one) does not double-count against the cap', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 're-invite');
    // Cap of 2: room for the owner (1 active) plus exactly one pending invite.
    const plan = await createTightPlan(db, owner, { seatsAllowed: 2 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const first = await createOrganizationInvitation(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      email: 'repeat@example.com',
      role: 'CASE_MANAGER',
    });
    expect(isOk(first)).toBe(true);
    // Re-inviting the SAME email supersedes (revokes) the stale pending row
    // before minting the new one, so this must still be exactly "1 active +
    // 1 pending" against a cap of 2, not "1 active + 2 pending".
    const second = await createOrganizationInvitation(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      email: 'repeat@example.com',
      role: 'ADMIN',
    });
    expect(isOk(second)).toBe(true);
  });
});

describe('checkCaseCreationEntitlement - case creation (COM-02)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'cases');
  });

  it('an individual case with no ownerOrganizationId is never capped, regardless of any plan', async () => {
    const traveller = await seedTraveller(db, 'individual');
    const { organizationId } = await seedOrganization(db, 'individual-org');
    const plan = await createTightPlan(db, owner, {
      casesPerPeriodAllowed: 0,
      concurrentOpenCasesAllowed: 0,
    });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const mission = await createMission(db, {
      actorAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      title: 'My own case',
      // Deliberately no ownerOrganizationId.
    });
    expect(isOk(mission)).toBe(true);
  });

  it('blocks a new org-owned case once casesPerPeriodAllowed is reached', async () => {
    const traveller = await seedTraveller(db, 'period-cap');
    const { organizationId } = await seedOrganization(db, 'period-cap-org');
    const plan = await createTightPlan(db, owner, { casesPerPeriodAllowed: 1 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const first = await createMission(db, {
      actorAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      title: 'First case',
      ownerOrganizationId: organizationId,
    });
    expect(isOk(first)).toBe(true);

    const second = await createMission(db, {
      actorAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      title: 'Second case',
      ownerOrganizationId: organizationId,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.message).toContain('period');
  });

  it('blocks a new org-owned case once concurrentOpenCasesAllowed is reached, even with casesPerPeriodAllowed headroom to spare', async () => {
    const traveller = await seedTraveller(db, 'concurrent-cap');
    const { organizationId } = await seedOrganization(db, 'concurrent-cap-org');
    const plan = await createTightPlan(db, owner, {
      casesPerPeriodAllowed: 100,
      concurrentOpenCasesAllowed: 1,
    });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const first = await createMission(db, {
      actorAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      title: 'Open case',
      ownerOrganizationId: organizationId,
    });
    expect(isOk(first)).toBe(true);

    const second = await createMission(db, {
      actorAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      title: 'Second open case',
      ownerOrganizationId: organizationId,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.message).toContain('concurrent');

    // Closing the first case frees the one concurrent slot.
    if (!isOk(first)) throw new Error('first');
    await db
      .update(schema.missions)
      .set({ state: 'CLOSED' })
      .where(eq(schema.missions.id, first.value.id));
    const third = await createMission(db, {
      actorAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      title: 'Third case, after closing the first',
      ownerOrganizationId: organizationId,
    });
    expect(isOk(third)).toBe(true);
  });

  it('under real concurrency, two simultaneous org-owned case creations for the last remaining concurrent slot never both succeed', async () => {
    const traveller = await seedTraveller(db, 'case-race');
    const { organizationId } = await seedOrganization(db, 'case-race-org');
    const plan = await createTightPlan(db, owner, {
      casesPerPeriodAllowed: 100,
      concurrentOpenCasesAllowed: 1,
    });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });

    const [a, b] = await Promise.all([
      createMission(db, {
        actorAccountId: traveller.accountId,
        applicantId: traveller.applicantId,
        title: 'Race A',
        ownerOrganizationId: organizationId,
      }),
      createMission(db, {
        actorAccountId: traveller.accountId,
        applicantId: traveller.applicantId,
        title: 'Race B',
        ownerOrganizationId: organizationId,
      }),
    ]);
    const results = [a, b];
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(1);
  });
});

describe('checkStorageEntitlement - upload storage (COM-02)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'storage');
  });

  it('allows an upload when no organization has grant access to the applicant yet', async () => {
    const traveller = await seedTraveller(db, 'no-org');
    const result = await reserveUpload(
      db,
      { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 5 * MB },
      generousUploadConfig,
    );
    expect(isOk(result)).toBe(true);
  });

  it('blocks an upload once the accessing organization would exceed its plan storage cap', async () => {
    const traveller = await seedTraveller(db, 'org-cap');
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'org-cap-org');
    const plan = await createTightPlan(db, owner, { storageBytesAllowed: 10 * MB });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    await grantOrgAccessToApplicant(db, {
      applicantOwnerAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      organizationId,
      orgOwnerAccountId: ownerAccountId,
    });

    const first = await reserveUpload(
      db,
      { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 8 * MB },
      generousUploadConfig,
    );
    expect(isOk(first)).toBe(true);

    // 8 + 5 = 13 MB > the org's 10 MB plan cap.
    const second = await reserveUpload(
      db,
      { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 5 * MB },
      generousUploadConfig,
    );
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.message).toContain('plan storage limit');
  });

  it('checks paid storage limits even when another accessing organization has founding access', async () => {
    const traveller = await seedTraveller(db, 'multi-org');
    const roomy = await seedOrganization(db, 'multi-org-roomy', true);
    const tight = await seedOrganization(db, 'multi-org-tight');
    const tightPlan = await createTightPlan(db, owner, { storageBytesAllowed: 6 * MB });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: tight.organizationId,
      planId: tightPlan.id,
      reason: 'test',
    });
    await grantOrgAccessToApplicant(db, {
      applicantOwnerAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      organizationId: roomy.organizationId,
      orgOwnerAccountId: roomy.ownerAccountId,
    });
    await grantOrgAccessToApplicant(db, {
      applicantOwnerAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      organizationId: tight.organizationId,
      orgOwnerAccountId: tight.ownerAccountId,
    });

    // 8 MB comfortably fits the roomy org's 1000 MB cap, but exceeds the
    // tight org's 6 MB cap -- must be refused because BOTH orgs' caps are
    // checked, not just the first (or an arbitrary) one.
    const result = await reserveUpload(
      db,
      { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 8 * MB },
      generousUploadConfig,
    );
    expect(isErr(result)).toBe(true);
  });

  it('unlimited when the accessing organization has no plan, or a plan with storageBytesAllowed left null', async () => {
    const traveller = await seedTraveller(db, 'org-unlimited');
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'org-unlimited-org');
    await grantOrgAccessToApplicant(db, {
      applicantOwnerAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      organizationId,
      orgOwnerAccountId: ownerAccountId,
    });
    // No plan assigned at all yet.
    const result = await reserveUpload(
      db,
      { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 50 * MB },
      generousUploadConfig,
    );
    expect(isOk(result)).toBe(true);
  });

  it("under real concurrency, two simultaneous uploads racing for an organization's last remaining storage headroom never both succeed", async () => {
    const traveller = await seedTraveller(db, 'storage-race');
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'storage-race-org');
    const plan = await createTightPlan(db, owner, { storageBytesAllowed: 10 * MB });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    await grantOrgAccessToApplicant(db, {
      applicantOwnerAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      organizationId,
      orgOwnerAccountId: ownerAccountId,
    });

    // 6 + 6 = 12 MB > the org's 10 MB cap: at most one of these two
    // genuinely concurrent reservations may succeed.
    const [a, b] = await Promise.all([
      reserveUpload(
        db,
        { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 6 * MB },
        generousUploadConfig,
      ),
      reserveUpload(
        db,
        { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 6 * MB },
        generousUploadConfig,
      ),
    ]);
    const results = [a, b];
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(1);
  });
});

describe('suspended billing blocks new paid work (COM-02 + COM-03)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'suspended');
  });

  async function suspendOrg(organizationId: string): Promise<void> {
    const opened = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'onboarding',
    });
    if (!isOk(opened)) throw new Error('open billing account');
    const suspended = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'SUSPENDED',
      reason: 'non-payment',
    });
    if (!isOk(suspended)) throw new Error('suspend');
  }

  it('keeps complimentary founding collaboration available without billing while retaining infrastructure limits', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'founding-free', true);
    await suspendOrg(organizationId);
    const invited = await createOrganizationInvitation(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      email: 'founding-team@example.com',
      role: 'CASE_MANAGER',
    });
    expect(isOk(invited)).toBe(true);
    const traveller = await seedTraveller(db, 'founding-free');
    await grantOrgAccessToApplicant(db, {
      applicantOwnerAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      organizationId,
      orgOwnerAccountId: ownerAccountId,
    });
    const allowed = await reserveUpload(
      db,
      { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: MB },
      generousUploadConfig,
    );
    expect(isOk(allowed)).toBe(true);
    const oversized = await reserveUpload(
      db,
      { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 101 * MB },
      generousUploadConfig,
    );
    expect(isErr(oversized)).toBe(true);
    const outsider = await provisionAccount(db, { email: 'founding-outsider@example.com' });
    if (!isOk(outsider)) throw new Error('outsider');
    const denied = await createOrganizationInvitation(db, {
      actorAccountId: outsider.value.id,
      organizationId,
      email: 'unauthorized@example.com',
      role: 'CASE_MANAGER',
    });
    expect(isErr(denied)).toBe(true);
  });

  it('blocks addMembership once billing is suspended, even with generous seat headroom to spare', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'seats-suspended');
    const plan = await createPlan(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      key: 'suspended-seats-plan',
      name: 'Suspended Seats Plan',
      seatsAllowed: 100,
    });
    if (!isOk(plan)) throw new Error('plan');
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.value.id,
      reason: 'test',
    });
    await suspendOrg(organizationId);

    const newMember = await provisionAccount(db, { email: 'm-suspended-seats@acme.com' });
    if (!isOk(newMember)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: newMember.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isErr(added)).toBe(true);
    if (isErr(added)) expect(added.error.message).toContain('suspended');
  });

  it('blocks createOrganizationInvitation once billing is suspended, even with no plan assigned at all', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'invite-suspended');
    await suspendOrg(organizationId);
    const invited = await createOrganizationInvitation(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      email: 'blocked-suspended@example.com',
      role: 'CASE_MANAGER',
    });
    expect(isErr(invited)).toBe(true);
    if (isErr(invited)) expect(invited.error.message).toContain('suspended');
  });

  it('blocks createMission (org-owned) once billing is suspended, even with no plan assigned at all', async () => {
    const traveller = await seedTraveller(db, 'case-suspended');
    const { organizationId } = await seedOrganization(db, 'case-suspended-org');
    await suspendOrg(organizationId);
    const mission = await createMission(db, {
      actorAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      title: 'Should be blocked',
      ownerOrganizationId: organizationId,
    });
    expect(isErr(mission)).toBe(true);
    if (isErr(mission)) expect(mission.error.message).toContain('suspended');
  });

  it('blocks reserveUpload once an accessing organization is suspended, even with no plan assigned at all', async () => {
    const traveller = await seedTraveller(db, 'storage-suspended');
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'storage-suspended-org');
    await grantOrgAccessToApplicant(db, {
      applicantOwnerAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      organizationId,
      orgOwnerAccountId: ownerAccountId,
    });
    await suspendOrg(organizationId);
    const result = await reserveUpload(
      db,
      { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 1 * MB },
      generousUploadConfig,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('suspended');
  });

  it('does not block when billing is ACTIVE, not SUSPENDED -- the gate only fires on the real SUSPENDED status', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'active-not-blocked');
    const opened = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'onboarding',
    });
    expect(isOk(opened)).toBe(true);

    const newMember = await provisionAccount(db, { email: 'm-active-ok@acme.com' });
    if (!isOk(newMember)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: newMember.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(added)).toBe(true);
  });

  it('reactivating billing (SUSPENDED -> ACTIVE) immediately un-blocks new work', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'reactivated');
    await suspendOrg(organizationId);

    const blockedMember = await provisionAccount(db, { email: 'm-blocked@acme.com' });
    if (!isOk(blockedMember)) throw new Error('provision');
    const blocked = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: blockedMember.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isErr(blocked)).toBe(true);

    const reactivated = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'ACTIVE',
      reason: 'payment received',
    });
    expect(isOk(reactivated)).toBe(true);

    const allowedMember = await provisionAccount(db, { email: 'm-allowed@acme.com' });
    if (!isOk(allowedMember)) throw new Error('provision');
    const allowed = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: allowedMember.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(allowed)).toBe(true);
  });
});

describe('commercial override bypasses every commercial check (COM-02)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'override');
  });

  async function grantOverride(organizationId: string) {
    const granted = await grantCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'exceptional case',
      durationDays: 7,
    });
    if (!isOk(granted)) throw new Error('grant override');
    return granted.value;
  }

  it('bypasses the seat cap for addMembership, even genuinely at the limit', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'override-seats');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 1 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    // Already at the 1-seat cap (the org owner is the sole active seat).
    await grantOverride(organizationId);

    const member = await provisionAccount(db, { email: 'override-seat-member@acme.com' });
    if (!isOk(member)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: member.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(added)).toBe(true);
  });

  it('bypasses the invitation cap for createOrganizationInvitation', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'override-invite');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 1 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    await grantOverride(organizationId);

    const invited = await createOrganizationInvitation(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      email: 'override-invitee@example.com',
      role: 'CASE_MANAGER',
    });
    expect(isOk(invited)).toBe(true);
  });

  it('bypasses both the per-period and concurrent-open case caps for createMission', async () => {
    const traveller = await seedTraveller(db, 'override-case');
    const { organizationId } = await seedOrganization(db, 'override-case-org');
    const plan = await createTightPlan(db, owner, {
      casesPerPeriodAllowed: 0,
      concurrentOpenCasesAllowed: 0,
    });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    await grantOverride(organizationId);

    const mission = await createMission(db, {
      actorAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      title: 'Should be allowed under override',
      ownerOrganizationId: organizationId,
    });
    expect(isOk(mission)).toBe(true);
  });

  it('bypasses the storage cap for reserveUpload', async () => {
    const traveller = await seedTraveller(db, 'override-storage');
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'override-storage-org');
    await grantOrgAccessToApplicant(db, {
      applicantOwnerAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      organizationId,
      orgOwnerAccountId: ownerAccountId,
    });
    const plan = await createTightPlan(db, owner, { storageBytesAllowed: 1 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    await grantOverride(organizationId);

    const result = await reserveUpload(
      db,
      { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes: 1 * MB },
      generousUploadConfig,
    );
    expect(isOk(result)).toBe(true);
  });

  it('also bypasses a SUSPENDED billing status -- the override supersedes suspension too, not just the plan cap', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'override-suspended');
    const opened = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'onboarding',
    });
    if (!isOk(opened)) throw new Error('open billing account');
    const suspended = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'SUSPENDED',
      reason: 'non-payment',
    });
    if (!isOk(suspended)) throw new Error('suspend');
    await grantOverride(organizationId);

    const member = await provisionAccount(db, { email: 'override-vs-suspended@acme.com' });
    if (!isOk(member)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: member.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(added)).toBe(true);
  });

  it('revoking the override immediately re-establishes the block', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'override-revoke');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 1 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const override = await grantOverride(organizationId);

    const allowedMember = await provisionAccount(db, { email: 'override-revoke-allowed@acme.com' });
    if (!isOk(allowedMember)) throw new Error('provision');
    const allowed = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: allowedMember.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(allowed)).toBe(true);

    const revoked = await revokeCommercialOverride(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      overrideId: override.id,
      reason: 'resolved',
    });
    expect(isOk(revoked)).toBe(true);

    const blockedMember = await provisionAccount(db, { email: 'override-revoke-blocked@acme.com' });
    if (!isOk(blockedMember)) throw new Error('provision');
    const blocked = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: blockedMember.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isErr(blocked)).toBe(true);
  });

  it('an expired (but not revoked) override no longer bypasses the check', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'override-expired');
    const plan = await createTightPlan(db, owner, { seatsAllowed: 1 });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    const override = await grantOverride(organizationId);

    // Backdate both startAt and expiryAt into the past (expiryAt still after
    // startAt, satisfying commercial_overrides_expiry_after_start), matching
    // this file's established technique for exercising a time boundary
    // without actually waiting.
    await db
      .update(schema.commercialOverrides)
      .set({ startAt: new Date(Date.now() - 120_000), expiryAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.commercialOverrides.id, override.id));

    const member = await provisionAccount(db, { email: 'override-expired-member@acme.com' });
    if (!isOk(member)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: member.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isErr(added)).toBe(true);
  });
});

describe('OPS-04 (Commercial V1 Part 9): plan-limit analytics', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'ops04');
  });

  async function limitHits() {
    return (await db.select().from(schema.productEvents)).filter(
      (e) => e.eventType === 'PLAN_LIMIT_REACHED',
    );
  }

  async function onPlan(
    organizationId: string,
    entitlements: Parameters<typeof createTightPlan>[2],
  ) {
    const plan = await createTightPlan(db, owner, entitlements);
    const activated = await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: plan.id,
      reason: 'test',
    });
    if (!isOk(activated)) throw new Error('activate');
  }

  async function addMember(organizationId: string, ownerAccountId: string, email: string) {
    const member = await provisionAccount(db, { email });
    if (!isOk(member)) throw new Error('provision');
    return addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: member.value.id,
      role: 'CASE_MANAGER',
    });
  }

  it('records the seat cap being hit, once per organization and day however often it is hit again, and names no member', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'ops04-seats');
    await onPlan(organizationId, { seatsAllowed: 1 });

    for (const email of ['turned-away-1@acme.com', 'turned-away-2@acme.com']) {
      expect(isErr(await addMember(organizationId, ownerAccountId, email))).toBe(true);
    }

    const hits = await limitHits();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      accountId: null,
      organizationId,
      dimension: 'SEATS',
      metricValue: null,
    });
    expect(JSON.stringify(hits)).not.toContain('turned-away');
  });

  it('keeps one event per limit: a different limit on the same organization is a separate event', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'ops04-two-limits');
    await onPlan(organizationId, { seatsAllowed: 1 });
    await addMember(organizationId, ownerAccountId, 'turned-away@acme.com');
    const invited = await createOrganizationInvitation(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      email: 'invite-turned-away@example.com',
      role: 'CASE_MANAGER',
    });
    expect(isErr(invited)).toBe(true);

    expect((await limitHits()).map((e) => e.dimension).sort()).toEqual(['INVITATIONS', 'SEATS']);
  });

  it('records the case caps being hit, each under its own label', async () => {
    const traveller = await seedTraveller(db, 'ops04-cases');
    const perPeriod = await seedOrganization(db, 'ops04-period');
    const concurrent = await seedOrganization(db, 'ops04-concurrent');
    await onPlan(perPeriod.organizationId, { casesPerPeriodAllowed: 1 });
    await onPlan(concurrent.organizationId, {
      casesPerPeriodAllowed: 100,
      concurrentOpenCasesAllowed: 1,
    });

    for (const organizationId of [perPeriod.organizationId, concurrent.organizationId]) {
      for (const title of ['First', 'Second']) {
        await createMission(db, {
          actorAccountId: traveller.accountId,
          applicantId: traveller.applicantId,
          title,
          ownerOrganizationId: organizationId,
        });
      }
    }

    const hits = await limitHits();
    expect(hits.map((e) => [e.organizationId, e.dimension]).sort()).toEqual(
      [
        [perPeriod.organizationId, 'CASES_PER_PERIOD'],
        [concurrent.organizationId, 'OPEN_CASES'],
      ].sort(),
    );
  });

  it('records the storage cap being hit against the organization whose cap it was', async () => {
    const traveller = await seedTraveller(db, 'ops04-storage');
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'ops04-storage-org');
    await onPlan(organizationId, { storageBytesAllowed: 10 * MB });
    await grantOrgAccessToApplicant(db, {
      applicantOwnerAccountId: traveller.accountId,
      applicantId: traveller.applicantId,
      organizationId,
      orgOwnerAccountId: ownerAccountId,
    });
    const reserve = (sizeBytes: number) =>
      reserveUpload(
        db,
        { accountId: traveller.accountId, applicantId: traveller.applicantId, sizeBytes },
        generousUploadConfig,
      );
    expect(isOk(await reserve(8 * MB))).toBe(true);
    expect(isErr(await reserve(5 * MB))).toBe(true);

    expect(await limitHits()).toMatchObject([{ organizationId, dimension: 'STORAGE' }]);
  });

  it('records nothing while an organization is within its limits, or has no plan', async () => {
    const roomy = await seedOrganization(db, 'ops04-roomy');
    await onPlan(roomy.organizationId, { seatsAllowed: 5 });
    expect(isOk(await addMember(roomy.organizationId, roomy.ownerAccountId, 'fits@acme.com'))).toBe(
      true,
    );
    const planless = await seedOrganization(db, 'ops04-planless');
    expect(
      isOk(await addMember(planless.organizationId, planless.ownerAccountId, 'planless@acme.com')),
    ).toBe(true);
    expect(await limitHits()).toEqual([]);
  });

  it('still refuses with the same error whether or not the limit could be recorded', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'ops04-same-refusal');
    await onPlan(organizationId, { seatsAllowed: 1 });
    const first = await addMember(organizationId, ownerAccountId, 'refused-a@acme.com');
    // The second refusal records nothing new (same org, limit and day).
    const second = await addMember(organizationId, ownerAccountId, 'refused-b@acme.com');
    expect(isErr(first) && isErr(second)).toBe(true);
    if (isErr(first) && isErr(second)) {
      expect(second.error.code).toBe(first.error.code);
      expect(second.error.message).toBe(first.error.message);
    }
  });
});
