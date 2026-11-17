import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  acceptGrant,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  attachPackVersion,
  createApplicant,
  createGrant,
  createMission,
  createOrganization,
  createPack,
  provisionAccount,
  publishPackVersion,
  reviewOrganization,
  revokeGrant,
  setConsent,
} from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCases } from './console-data';
import { buildDoNextList } from './do-next';

/**
 * WP-PIC14 access proof on a real database with real grants: the desk picture counts reach an
 * agency only through the case reads it already makes. An agency the traveller shared the case
 * with sees the flag, the readiness counts and the documents count; an agency with no share sees
 * no case and so no counts; and once the share is revoked, the counts are gone on the next read.
 */

interface World {
  readonly db: Db;
  readonly travellerId: string;
  readonly sharedAdminId: string;
  readonly sharedOrgId: string;
  readonly otherAdminId: string;
  readonly otherOrgId: string;
  readonly missionId: string;
  readonly grantId: string;
}

let world: World;

async function account(db: Db, email: string): Promise<string> {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  return p.value.id;
}

async function activeAgency(db: Db, adminId: string, reviewerId: string, name: string) {
  const org = await createOrganization(db, { actorAccountId: adminId, name });
  if (!isOk(org)) throw new Error('org');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewerId,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  return org.value.id;
}

beforeAll(async () => {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema }) as unknown as Db;
  const travellerId = await account(db, 'pic14-traveller@example.com');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: travellerId,
      accountId: travellerId,
      type,
      granted: true,
    });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: travellerId,
    ownerAccountId: travellerId,
    displayName: 'Synthetic traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');

  // A published checklist with two required documents and one required answer.
  const pack = await createPack(db, {
    actorAccountId: travellerId,
    key: 'pic14.pack',
    name: 'Pack',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: travellerId, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  for (const requirement of [
    { kind: 'DOCUMENT' as const, docType: 'passport' },
    { kind: 'DOCUMENT' as const, docType: 'bank_statement' },
    { kind: 'FIELD' as const, fieldKey: 'passport.number' },
  ]) {
    const added = await addRequirement(db, {
      actorAccountId: travellerId,
      packVersionId: version.value.id,
      ...requirement,
      citation: 'rule 1',
    });
    if (!isOk(added)) throw new Error('requirement');
  }
  await approvePackVersion(db, { actorAccountId: travellerId, packVersionId: version.value.id });
  await publishPackVersion(db, { actorAccountId: travellerId, packVersionId: version.value.id });

  const mission = await createMission(db, {
    actorAccountId: travellerId,
    applicantId: applicant.value.id,
    title: 'Work Visa',
    destination: 'Japan',
  });
  if (!isOk(mission)) throw new Error('mission');
  const attached = await attachPackVersion(db, {
    actorAccountId: travellerId,
    missionId: mission.value.id,
    packVersionId: version.value.id,
  });
  if (!isOk(attached)) throw new Error('attach');

  const reviewerId = await account(db, 'pic14-reviewer@platform.example.com');
  const sharedAdminId = await account(db, 'pic14-shared@agency.example.com');
  const otherAdminId = await account(db, 'pic14-other@agency.example.com');
  const sharedOrgId = await activeAgency(db, sharedAdminId, reviewerId, 'Shared Agency');
  const otherOrgId = await activeAgency(db, otherAdminId, reviewerId, 'Other Agency');

  const grant = await createGrant(db, {
    actorAccountId: travellerId,
    applicantId: applicant.value.id,
    recipientOrganizationId: sharedOrgId,
    actions: ['MANAGE', 'COMMENT'],
    purpose: 'collaboration',
  });
  if (!isOk(grant)) throw new Error('grant');
  const accepted = await acceptGrant(db, {
    actorAccountId: sharedAdminId,
    grantId: grant.value.id,
  });
  if (!isOk(accepted)) throw new Error('accept');

  world = {
    db,
    travellerId,
    sharedAdminId,
    sharedOrgId,
    otherAdminId,
    otherOrgId,
    missionId: mission.value.id,
    grantId: grant.value.id,
  };
}, 120_000);

/** The Do Next list exactly as the Dashboard builds it from its own case read. */
async function deskFor(accountId: string, orgId: string) {
  const data = await loadCases(world.db, accountId, orgId);
  return buildDoNextList({
    admin: data.admin,
    viewerAccountId: accountId,
    cases: data.cases,
    requests: [],
    applicantWide: 'all',
    members: [],
    organizationName: null,
    base: `/app/agency/${orgId}`,
  }).items;
}

describe('desk picture counts and access (real grants)', () => {
  it('an agency with the share sees the flag, the readiness counts and the documents count; one without sees nothing', async () => {
    const shared = await deskFor(world.sharedAdminId, world.sharedOrgId);
    const row = shared.find((i) => i.key === `case:${world.missionId}`);
    expect(row?.picture).toEqual({
      destination: 'Japan',
      readiness: { done: 0, total: 3 },
      documentsMissing: 2,
    });

    const other = await deskFor(world.otherAdminId, world.otherOrgId);
    expect(other).toEqual([]);
    expect(JSON.stringify(other)).not.toContain(world.missionId);
  }, 60_000);

  it('after the traveller revokes the share, the counts are gone on the next read', async () => {
    const before = await deskFor(world.sharedAdminId, world.sharedOrgId);
    expect(before.find((i) => i.key === `case:${world.missionId}`)?.picture).toBeDefined();
    const revoked = await revokeGrant(world.db, {
      actorAccountId: world.travellerId,
      grantId: world.grantId,
    });
    expect(isOk(revoked)).toBe(true);
    const after = await deskFor(world.sharedAdminId, world.sharedOrgId);
    expect(after.some((i) => i.picture !== undefined)).toBe(false);
    expect(JSON.stringify(after)).not.toContain(world.missionId);
  }, 60_000);
});
