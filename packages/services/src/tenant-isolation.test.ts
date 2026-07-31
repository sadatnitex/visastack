import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  addNote,
  assignMember,
  bulkExport,
  listApplicantsForOrganization,
  listMissionsForOrganization,
  requestEvidence,
} from './agency';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission } from './missions';
import {
  addMembership,
  createOrganization,
  reviewOrganization,
  setMembershipActive,
} from './organizations';
import { editFact, registerFieldDefinition } from './profile';
import { acceptGrant, createGrant, pauseGrant, resumeGrant, revokeGrant } from './sharing';

/**
 * Hostile-authorization regression suite (master recovery directive §7
 * "PR 2"): every scenario here proves a specific tenant-isolation or
 * grant-lifecycle property that PR 2 introduced or repaired. See
 * docs/security/tenant-isolation-matrix.md for the property-to-test map.
 */

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

/** A fully consented applicant owner (core processing + sharing), ready to grant access. */
async function consentedOwner(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type,
      granted: true,
    });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { account, applicantId: applicant.value.id };
}

/**
 * An independently-verified (ACTIVE) organization with its creator as the
 * sole OWNER — a grant can only ever target an ACTIVE organization
 * (createGrant), so every org this suite shares access with must clear
 * review first, exactly like production. The reviewer is a disposable
 * account with no membership anywhere, matching the real rule that an
 * organization can never verify itself.
 */
async function ownerOrg(db: Db, email: string, name: string) {
  const acc = await provisionAccount(db, { email });
  if (!isOk(acc)) throw new Error('provision');
  const org = await createOrganization(db, { actorAccountId: acc.value.id, name });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${org.value.id}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
  });
  if (!isOk(reviewed)) throw new Error('review');
  return { account: acc.value, organizationId: org.value.id };
}

/** Force a grant's expiry into the past, bypassing createGrant's future-only validation — direct schema access for a hostile time-window test only. */
async function expireGrantNow(db: Db, grantId: string): Promise<void> {
  await db
    .update(schema.grants)
    .set({ expiryAt: new Date(Date.now() - 1000) })
    .where(eq(schema.grants.id, grantId));
}

describe('cross-tenant isolation — two organizations, one applicant', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('org B has zero standing on an applicant who only ever granted org A', async () => {
    const { account, applicantId } = await consentedOwner(db, 'iso-owner@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const orgA = await ownerOrg(db, 'iso-a@acme.com', 'Org A');
    const orgB = await ownerOrg(db, 'iso-b@acme.com', 'Org B');

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: orgA.organizationId,
      actions: ['MANAGE', 'COMMENT', 'EXPORT_PROFILE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: orgA.account.id, grantId: grant.value.id });

    // Org A: full standing.
    expect(await listMissionsForOrganization(db, orgA.organizationId)).toHaveLength(1);
    expect(await listApplicantsForOrganization(db, orgA.organizationId)).toHaveLength(1);

    // Org B: nothing, on every surface — even though it's the SAME applicant/mission.
    expect(await listMissionsForOrganization(db, orgB.organizationId)).toHaveLength(0);
    expect(await listApplicantsForOrganization(db, orgB.organizationId)).toHaveLength(0);

    const assignDenied = await assignMember(db, {
      actorAccountId: orgB.account.id,
      organizationId: orgB.organizationId,
      memberAccountId: orgB.account.id,
      missionId: mission.value.id,
    });
    expect(isErr(assignDenied)).toBe(true);

    const noteDenied = await addNote(db, {
      actorAccountId: orgB.account.id,
      missionId: mission.value.id,
      body: 'trying to comment from org B',
    });
    expect(isErr(noteDenied)).toBe(true);

    const evidenceDenied = await requestEvidence(db, {
      actorAccountId: orgB.account.id,
      organizationId: orgB.organizationId,
      applicantId,
      kind: 'FIELD',
      fieldKey: 'passport_number',
    });
    expect(isErr(evidenceDenied)).toBe(true);

    const exportB = await bulkExport(db, {
      actorAccountId: orgB.account.id,
      organizationId: orgB.organizationId,
      purpose: 'collaboration',
      stepUpSatisfied: true,
    });
    expect(isOk(exportB)).toBe(true);
    if (isOk(exportB)) expect(exportB.value).toHaveLength(0);
  });

  it('an org admin cannot deactivate or reactivate a membership belonging to a different organization (cross-tenant IDOR regression)', async () => {
    const orgA = await ownerOrg(db, 'idor-a@acme.com', 'Org A');
    const orgB = await ownerOrg(db, 'idor-b@acme.com', 'Org B');
    const memberB = await provisionAccount(db, { email: 'idor-memberb@acme.com' });
    if (!isOk(memberB)) throw new Error('provision');
    const addedB = await addMembership(db, {
      actorAccountId: orgB.account.id,
      organizationId: orgB.organizationId,
      accountId: memberB.value.id,
      role: 'CASE_MANAGER',
    });
    if (!isOk(addedB)) throw new Error('membership');

    // Org A's admin, scoping the call to their OWN org, cannot reach a
    // membership row that actually belongs to org B — the membership id
    // alone is not enough (this was the confirmed defect: the previous
    // implementation updated by membershipId alone with no organizationId
    // clause tying the row to the caller's own org).
    const wrongOrgScope = await setMembershipActive(db, {
      actorAccountId: orgA.account.id,
      organizationId: orgA.organizationId,
      membershipId: addedB.value.id,
      active: false,
    });
    expect(isErr(wrongOrgScope)).toBe(true);
    if (isErr(wrongOrgScope)) expect(wrongOrgScope.error.code).toBe('not_found');

    // Naming org B's real id doesn't help either — org A's admin has no
    // membership of their own in org B, so the actor-side check denies first.
    const notAMember = await setMembershipActive(db, {
      actorAccountId: orgA.account.id,
      organizationId: orgB.organizationId,
      membershipId: addedB.value.id,
      active: false,
    });
    expect(isErr(notAMember)).toBe(true);
    if (isErr(notAMember)) expect(notAMember.error.code).toBe('forbidden');

    // The membership is untouched by either attempt.
    const stillActive = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, addedB.value.id));
    expect(stillActive[0]?.active).toBe(true);
  });

  it('raw UUID guessing never succeeds — random ids are not_found or forbidden, never allowed', async () => {
    const { account, applicantId } = await consentedOwner(db, 'guess-owner@example.com');
    const orgA = await ownerOrg(db, 'guess-a@acme.com', 'Org A');
    const guessedOrgId = randomUUID();
    const guessedMissionId = randomUUID();
    const guessedMembershipId = randomUUID();
    const guessedGrantId = randomUUID();

    const assignGuess = await assignMember(db, {
      actorAccountId: orgA.account.id,
      organizationId: orgA.organizationId,
      memberAccountId: orgA.account.id,
      missionId: guessedMissionId,
    });
    expect(isErr(assignGuess)).toBe(true);

    const evidenceGuess = await requestEvidence(db, {
      actorAccountId: orgA.account.id,
      organizationId: guessedOrgId,
      applicantId,
      kind: 'FIELD',
      fieldKey: 'passport_number',
    });
    expect(isErr(evidenceGuess)).toBe(true);

    const membershipGuess = await setMembershipActive(db, {
      actorAccountId: orgA.account.id,
      organizationId: orgA.organizationId,
      membershipId: guessedMembershipId,
      active: false,
    });
    expect(isErr(membershipGuess)).toBe(true);
    if (isErr(membershipGuess)) expect(membershipGuess.error.code).toBe('not_found');

    const acceptGuess = await acceptGrant(db, {
      actorAccountId: orgA.account.id,
      grantId: guessedGrantId,
    });
    expect(isErr(acceptGuess)).toBe(true);
    if (isErr(acceptGuess)) expect(acceptGuess.error.code).toBe('not_found');

    const exportGuess = await bulkExport(db, {
      actorAccountId: orgA.account.id,
      organizationId: guessedOrgId,
      purpose: 'x',
      stepUpSatisfied: true,
    });
    expect(isErr(exportGuess)).toBe(true);

    void applicantId;
    void account;
  });
});

describe('grant scope cannot be escaped', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('a mission-scoped grant does not authorize collaboration on a different mission of the same applicant', async () => {
    const { account, applicantId } = await consentedOwner(db, 'scope-owner@example.com');
    const missionA = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Mission A',
    });
    const missionB = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Mission B',
    });
    if (!isOk(missionA) || !isOk(missionB)) throw new Error('mission');
    const org = await ownerOrg(db, 'scope-agent@acme.com', 'Acme');

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.organizationId,
      missionId: missionA.value.id,
      actions: ['MANAGE', 'COMMENT'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: org.account.id, grantId: grant.value.id });

    const assignOnGrantedMission = await assignMember(db, {
      actorAccountId: org.account.id,
      organizationId: org.organizationId,
      memberAccountId: org.account.id,
      missionId: missionA.value.id,
    });
    expect(isOk(assignOnGrantedMission)).toBe(true);

    const assignOnOtherMission = await assignMember(db, {
      actorAccountId: org.account.id,
      organizationId: org.organizationId,
      memberAccountId: org.account.id,
      missionId: missionB.value.id,
    });
    expect(isErr(assignOnOtherMission)).toBe(true);

    const noteOnOtherMission = await addNote(db, {
      actorAccountId: org.account.id,
      missionId: missionB.value.id,
      body: 'should not be allowed',
    });
    expect(isErr(noteOnOtherMission)).toBe(true);
  });

  it('a personal (individual) grant never substitutes for organizational membership', async () => {
    const { account, applicantId } = await consentedOwner(db, 'personal-owner@example.com');
    const individual = await provisionAccount(db, { email: 'personal-recipient@example.com' });
    if (!isOk(individual)) throw new Error('provision');

    // A direct, personal grant with MANAGE — accepted, fully active.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: individual.value.id,
      actions: ['MANAGE'],
      purpose: 'p',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: individual.value.id, grantId: grant.value.id });

    // That individual is not a member of ANY organization, so org-mediated
    // actions must deny regardless of their personal grant.
    const unrelatedOrg = await ownerOrg(db, 'personal-org@acme.com', 'Unrelated Org');
    const evidenceAttempt = await requestEvidence(db, {
      actorAccountId: individual.value.id,
      organizationId: unrelatedOrg.organizationId,
      applicantId,
      kind: 'FIELD',
      fieldKey: 'passport_number',
    });
    expect(isErr(evidenceAttempt)).toBe(true);
    if (isErr(evidenceAttempt)) expect(evidenceAttempt.error.code).toBe('forbidden');
  });

  it('bulk export excludes an applicant once the grant it depended on is revoked, and respects category scope', async () => {
    const org = await ownerOrg(db, 'bulk-scope-agent@acme.com', 'Acme');
    await registerFieldDefinition(db, {
      key: 'name.full',
      dataType: 'string',
      packId: 'universal',
    });
    await registerFieldDefinition(db, {
      key: 'company_name',
      dataType: 'string',
      packId: 'business',
    });

    const owner = await consentedOwner(db, 'bulk-scope-owner@example.com');
    await editFact(db, {
      actorAccountId: owner.account.id,
      applicantId: owner.applicantId,
      fieldKey: 'name.full',
      value: 'Alice',
    });
    await editFact(db, {
      actorAccountId: owner.account.id,
      applicantId: owner.applicantId,
      fieldKey: 'company_name',
      value: 'Acme Corp',
    });

    const grant = await createGrant(db, {
      actorAccountId: owner.account.id,
      applicantId: owner.applicantId,
      recipientOrganizationId: org.organizationId,
      actions: ['EXPORT_PROFILE'],
      purpose: 'bulk',
      categories: ['universal'],
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: org.account.id, grantId: grant.value.id });

    const scoped = await bulkExport(db, {
      actorAccountId: org.account.id,
      organizationId: org.organizationId,
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    expect(isOk(scoped)).toBe(true);
    if (isOk(scoped)) {
      expect(scoped.value).toHaveLength(1);
      // universal-pack field visible, business-pack field scoped out.
      expect(scoped.value[0]?.facts['name.full']).toBe('Alice');
      // biome-ignore lint/complexity/useLiteralKeys: Record<string, ...> requires bracket access under noPropertyAccessFromIndexSignature.
      expect(scoped.value[0]?.facts['company_name']).toBeUndefined();
    }

    await revokeGrant(db, { actorAccountId: owner.account.id, grantId: grant.value.id });

    const afterRevoke = await bulkExport(db, {
      actorAccountId: org.account.id,
      organizationId: org.organizationId,
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    expect(isOk(afterRevoke)).toBe(true);
    if (isOk(afterRevoke)) expect(afterRevoke.value).toHaveLength(0);
  });
});

describe('grant lifecycle — hostile state transitions', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function activeCollaborationGrant(email: string) {
    const owner = await consentedOwner(db, `${email}-owner@example.com`);
    const org = await ownerOrg(db, `${email}-agent@acme.com`, 'Acme');
    const grant = await createGrant(db, {
      actorAccountId: owner.account.id,
      applicantId: owner.applicantId,
      recipientOrganizationId: org.organizationId,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: org.account.id, grantId: grant.value.id });
    return { owner, org, grantId: grant.value.id };
  }

  it('a revoked grant is permanently terminal: cannot resume, cannot pause, cannot re-accept', async () => {
    const { owner, grantId } = await activeCollaborationGrant('revoke-terminal');
    await revokeGrant(db, { actorAccountId: owner.account.id, grantId });

    const reAccept = await acceptGrant(db, { actorAccountId: owner.account.id, grantId });
    expect(isErr(reAccept)).toBe(true);

    const resumed = await resumeGrant(db, { actorAccountId: owner.account.id, grantId });
    expect(isErr(resumed)).toBe(true);
    if (isErr(resumed)) expect(resumed.error.code).toBe('invalid');

    const paused = await pauseGrant(db, { actorAccountId: owner.account.id, grantId });
    expect(isErr(paused)).toBe(true);
    if (isErr(paused)) expect(paused.error.code).toBe('invalid');
  });

  it('a paused grant blocks org-mediated access; resuming restores it', async () => {
    const { owner, org, grantId } = await activeCollaborationGrant('pause-resume');
    const mission = await createMission(db, {
      actorAccountId: owner.account.id,
      applicantId: owner.applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');

    await pauseGrant(db, { actorAccountId: owner.account.id, grantId });
    const whilePaused = await assignMember(db, {
      actorAccountId: org.account.id,
      organizationId: org.organizationId,
      memberAccountId: org.account.id,
      missionId: mission.value.id,
    });
    expect(isErr(whilePaused)).toBe(true);

    await resumeGrant(db, { actorAccountId: owner.account.id, grantId });
    const afterResume = await assignMember(db, {
      actorAccountId: org.account.id,
      organizationId: org.organizationId,
      memberAccountId: org.account.id,
      missionId: mission.value.id,
    });
    expect(isOk(afterResume)).toBe(true);
  });

  it('an expired grant blocks org-mediated access even while its status still reads ACTIVE', async () => {
    const { owner, org, grantId } = await activeCollaborationGrant('expiry');
    await expireGrantNow(db, grantId);

    const evidenceAfterExpiry = await requestEvidence(db, {
      actorAccountId: org.account.id,
      organizationId: org.organizationId,
      applicantId: owner.applicantId,
      kind: 'FIELD',
      fieldKey: 'passport_number',
    });
    expect(isErr(evidenceAfterExpiry)).toBe(true);
    if (isErr(evidenceAfterExpiry)) expect(evidenceAfterExpiry.error.code).toBe('forbidden');
  });

  it('double-accepting the same grant: exactly one attempt succeeds', async () => {
    const owner = await consentedOwner(db, 'double-accept-owner@example.com');
    const org = await ownerOrg(db, 'double-accept-agent@acme.com', 'Acme');
    const grant = await createGrant(db, {
      actorAccountId: owner.account.id,
      applicantId: owner.applicantId,
      recipientOrganizationId: org.organizationId,
      actions: ['PREVIEW'],
      purpose: 'p',
    });
    if (!isOk(grant)) throw new Error('grant');

    const [first, second] = await Promise.all([
      acceptGrant(db, { actorAccountId: org.account.id, grantId: grant.value.id }),
      acceptGrant(db, { actorAccountId: org.account.id, grantId: grant.value.id }),
    ]);
    const results = [first, second];
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(1);
  });

  it('two concurrent revoke attempts on the same grant: exactly one succeeds', async () => {
    // Revoke is terminal (its own allowedFrom never includes REVOKED), so
    // unlike pause→revoke (a legitimate chain — revoke's allowedFrom
    // deliberately includes PAUSED), two revokes of the same grant can never
    // both land: whichever transaction's CAS write commits first is the only
    // one that observes the required pre-revoke status.
    const { owner, grantId } = await activeCollaborationGrant('conflict-transition');
    const [first, second] = await Promise.all([
      revokeGrant(db, { actorAccountId: owner.account.id, grantId }),
      revokeGrant(db, { actorAccountId: owner.account.id, grantId }),
    ]);
    const results = [first, second];
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(1);

    const final = await db.select().from(schema.grants).where(eq(schema.grants.id, grantId));
    expect(final[0]?.status).toBe('REVOKED');
  });
});

describe('organization ownership safety', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('cannot deactivate the sole remaining active owner', async () => {
    const org = await ownerOrg(db, 'sole-owner@acme.com', 'Acme');
    const members = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.organizationId, org.organizationId));
    const ownerMembership = members[0];
    if (!ownerMembership) throw new Error('membership');

    const denied = await setMembershipActive(db, {
      actorAccountId: org.account.id,
      organizationId: org.organizationId,
      membershipId: ownerMembership.id,
      active: false,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('invalid');
  });

  it('deactivating one of two owners succeeds and the org retains exactly one active owner', async () => {
    const org = await ownerOrg(db, 'two-owner@acme.com', 'Acme');
    const coOwner = await provisionAccount(db, { email: 'two-owner-co@acme.com' });
    if (!isOk(coOwner)) throw new Error('provision');
    const added = await addMembership(db, {
      actorAccountId: org.account.id,
      organizationId: org.organizationId,
      accountId: coOwner.value.id,
      role: 'OWNER',
    });
    if (!isOk(added)) throw new Error('membership');

    const founderMembership = (
      await db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.accountId, org.account.id))
    )[0];
    if (!founderMembership) throw new Error('membership');

    const deactivated = await setMembershipActive(db, {
      actorAccountId: coOwner.value.id,
      organizationId: org.organizationId,
      membershipId: founderMembership.id,
      active: false,
    });
    expect(isOk(deactivated)).toBe(true);

    const activeOwners = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.organizationId, org.organizationId));
    expect(activeOwners.filter((m) => m.active && m.role === 'OWNER')).toHaveLength(1);
  });
});
