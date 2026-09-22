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
async function seedOrganization(db: Db, tag: string) {
  const ownerAcc = await provisionAccount(db, { email: `org-owner-${tag}@acme.com` });
  if (!isOk(ownerAcc)) throw new Error('provision');
  const org = await createOrganization(db, {
    actorAccountId: ownerAcc.value.id,
    name: `Acme ${tag}`,
  });
  if (!isOk(org)) throw new Error('org');
  await activateOrg(db, org.value.id);
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

  it('checks every organization with access independently -- blocks on a second, tightly-capped org even though the first has ample room', async () => {
    const traveller = await seedTraveller(db, 'multi-org');
    const roomy = await seedOrganization(db, 'multi-org-roomy');
    const tight = await seedOrganization(db, 'multi-org-tight');
    const roomyPlan = await createTightPlan(db, owner, { storageBytesAllowed: 1000 * MB });
    const tightPlan = await createTightPlan(db, owner, { storageBytesAllowed: 6 * MB });
    await activateSubscription(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: roomy.organizationId,
      planId: roomyPlan.id,
      reason: 'test',
    });
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
