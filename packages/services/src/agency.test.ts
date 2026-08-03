import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  addNote,
  assignMember,
  bulkExport,
  listApplicantsForOrganization,
  listAssignmentsDetailed,
  listEvidenceRequestsForApplicant,
  listEvidenceRequestsForOrg,
  listEvidenceRequestsForOrgDetailed,
  listMissionDecisions,
  listMissionsForOrganization,
  listNotes,
  recordMissionDecision,
  requestEvidence,
  respondEvidence,
} from './agency';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { attachPackVersion, createMission } from './missions';
import {
  addMembership,
  createOrganization,
  listMembershipsForAccount,
  reviewOrganization,
  setMembershipActive,
} from './organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { RATE_LIMITS } from './rate-limit';
import { acceptGrant, createGrant, pauseGrant, revokeGrant } from './sharing';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function consentedApplicant(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'SHARING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { account, applicantId: applicant.value.id };
}

/**
 * Independently verify a PENDING_VERIFICATION org (createGrant requires an
 * ACTIVE, verified recipient organization). The reviewer is a disposable,
 * unrelated account, matching the real rule that an org can never verify
 * itself.
 */
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

describe('agency collaboration — assignments, notes, evidence', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('assigns a member (admin only) and records notes', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'coll@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-coll@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // The org needs a current grant covering this mission before it can
    // assign members or comment (Build Spec law 2: membership alone is
    // never access).
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE', 'COMMENT'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const assigned = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });
    expect(isOk(assigned)).toBe(true);

    const note = await addNote(db, {
      actorAccountId: agentAcc.value.id,
      missionId: mission.value.id,
      body: 'Please add a bank statement.',
    });
    expect(isOk(note)).toBe(true);
    expect(await listNotes(db, org.value.id, applicantId, mission.value.id)).toHaveLength(1);

    // A non-admin cannot assign.
    const stranger = await provisionAccount(db, { email: 'stranger-coll@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await assignMember(db, {
      actorAccountId: stranger.value.id,
      organizationId: org.value.id,
      memberAccountId: stranger.value.id,
      missionId: mission.value.id,
    });
    expect(isErr(denied)).toBe(true);
  });

  it('runs the evidence-request lifecycle', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const req = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      message: 'last 3 months',
    });
    expect(isOk(req)).toBe(true);
    if (!isOk(req)) return;
    expect(req.value.status).toBe('OPEN');

    // A stranger cannot respond; the owner can.
    const other = await provisionAccount(db, { email: 'other-ev@example.com' });
    if (!isOk(other)) throw new Error('provision');
    const badResp = await respondEvidence(db, {
      actorAccountId: other.value.id,
      requestId: req.value.id,
      decision: 'FULFILLED',
    });
    expect(isErr(badResp)).toBe(true);

    const resp = await respondEvidence(db, {
      actorAccountId: account.id,
      requestId: req.value.id,
      decision: 'FULFILLED',
    });
    expect(isOk(resp)).toBe(true);
    if (isOk(resp)) expect(resp.value.status).toBe('FULFILLED');
  });

  it('refuses further evidence requests once the anti-automation limit is hit (Build Spec §14)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev-rate@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev-rate@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const attempt = () =>
      requestEvidence(db, {
        actorAccountId: agentAcc.value.id,
        organizationId: org.value.id,
        applicantId,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
      });

    for (let i = 0; i < RATE_LIMITS.EVIDENCE_REQUEST.limit; i++) {
      const result = await attempt();
      expect(isOk(result)).toBe(true);
    }
    const overLimit = await attempt();
    expect(isErr(overLimit)).toBe(true);
    if (isErr(overLimit)) {
      expect(overLimit.error.code).toBe('rate_limited');
    }
  });

  it('lists evidence requests for the applicant and the org, and org memberships', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev2@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev2@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'FIELD',
      fieldKey: 'passport_number',
    });

    // Applicant owner sees the request; a stranger is forbidden.
    const forApplicant = await listEvidenceRequestsForApplicant(db, account.id, applicantId);
    expect(isOk(forApplicant)).toBe(true);
    if (isOk(forApplicant)) expect(forApplicant.value).toHaveLength(1);
    const stranger = await listEvidenceRequestsForApplicant(db, agentAcc.value.id, applicantId);
    expect(isErr(stranger)).toBe(true);

    // Org admin sees the org's requests; a non-admin is forbidden.
    const forOrg = await listEvidenceRequestsForOrg(db, agentAcc.value.id, org.value.id);
    expect(isOk(forOrg)).toBe(true);
    if (isOk(forOrg)) expect(forOrg.value).toHaveLength(1);
    const notAdmin = await listEvidenceRequestsForOrg(db, account.id, org.value.id);
    expect(isErr(notAdmin)).toBe(true);

    // The creator is an OWNER member of the org.
    const memberships = await listMembershipsForAccount(db, agentAcc.value.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('OWNER');
    expect(memberships[0]?.organization.id).toBe(org.value.id);
  });

  it('resolves the applicant name on each org evidence request', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev3@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev3@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'FIELD',
      fieldKey: 'passport_number',
    });

    const detailed = await listEvidenceRequestsForOrgDetailed(db, agentAcc.value.id, org.value.id);
    expect(isOk(detailed)).toBe(true);
    if (isOk(detailed)) {
      expect(detailed.value).toHaveLength(1);
      expect(detailed.value[0]?.applicantName).toBe('Owner');
    }
  });

  it('resolves an assignment to the assigned member email', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'assign@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-assign@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });

    const assignments = await listAssignmentsDetailed(
      db,
      org.value.id,
      applicantId,
      mission.value.id,
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.memberEmail).toBe('agent-assign@acme.com');
  });

  it('lists missions reachable by an org via a mission-scoped grant', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'orgmission@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Business trip',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-orgmission@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // No grant yet — the mission isn't visible.
    expect(await listMissionsForOrganization(db, org.value.id)).toHaveLength(0);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['PREVIEW'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');

    // Still pending acceptance — still not visible (regression guard: a
    // grant must be actually accepted, not merely created, before it grants
    // any standing at all).
    expect(await listMissionsForOrganization(db, org.value.id)).toHaveLength(0);

    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const missions = await listMissionsForOrganization(db, org.value.id);
    expect(missions).toHaveLength(1);
    expect(missions[0]?.missionId).toBe(mission.value.id);
    expect(missions[0]?.title).toBe('Business trip');
    expect(missions[0]?.applicantName).toBe('Owner');
  });

  it('lists only applicants with a current (accepted, active) grant to this org (finding #3)', async () => {
    const a = await consentedApplicant(db, 'orgapp-a@example.com');
    const b = await consentedApplicant(db, 'orgapp-b@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-orgapp@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // A has an ACCEPTED grant to this org; B has not (created but never
    // accepted) — a pending, unaccepted grant must not surface the
    // applicant's name at all (docs/audits/post-programme-defect-register.md
    // finding #3), matching listMissionsForOrganization's own
    // accepted-grant requirement.
    const grantA = await createGrant(db, {
      actorAccountId: a.account.id,
      applicantId: a.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(grantA)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grantA.value.id });

    await createGrant(db, {
      actorAccountId: b.account.id,
      applicantId: b.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });

    const applicants = await listApplicantsForOrganization(db, org.value.id);
    expect(applicants).toHaveLength(1);
    expect(applicants[0]?.applicantId).toBe(a.applicantId);
    expect(applicants[0]?.displayName).toBe('Owner');
  });
});

describe('permissioned bulk export', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('includes only applicants who granted the org EXPORT_PROFILE', async () => {
    // Org + admin.
    const agentAcc = await provisionAccount(db, { email: 'agent-bulk@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const orgId = org.value.id;
    await registerFieldDefinition(db, { key: 'name.full', dataType: 'string' });

    // Applicant A grants EXPORT_PROFILE and accepts; applicant B grants nothing.
    const a = await consentedApplicant(db, 'a-bulk@example.com');
    await editFact(db, {
      actorAccountId: a.account.id,
      applicantId: a.applicantId,
      fieldKey: 'name.full',
      value: 'Alice',
    });
    const grant = await createGrant(db, {
      actorAccountId: a.account.id,
      applicantId: a.applicantId,
      recipientOrganizationId: orgId,
      actions: ['EXPORT_PROFILE'],
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const b = await consentedApplicant(db, 'b-bulk@example.com');
    await editFact(db, {
      actorAccountId: b.account.id,
      applicantId: b.applicantId,
      fieldKey: 'name.full',
      value: 'Bob',
    });

    const exported = await bulkExport(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: orgId,
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    expect(isOk(exported)).toBe(true);
    if (!isOk(exported)) return;
    // Only A (accepted EXPORT_PROFILE grant) is included.
    expect(exported.value).toHaveLength(1);
    expect(exported.value[0]?.facts['name.full']).toBe('Alice');
  });

  it('is denied for a non-admin caller', async () => {
    const agentAcc = await provisionAccount(db, { email: 'agent-bulk2@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const stranger = await provisionAccount(db, { email: 'stranger-bulk@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const result = await bulkExport(db, {
      actorAccountId: stranger.value.id,
      organizationId: org.value.id,
      purpose: 'bulk',
      stepUpSatisfied: false,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });
});

describe('reviewer decisions (master directive §7 "PR 10")', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function setUp(db: Db) {
    const { account, applicantId } = await consentedApplicant(db, 'dec@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');

    const pack = await createPack(db, { actorAccountId: account.id, key: 'dec.pack', name: 'Dec' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const requirement = await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'rule',
    });
    if (!isOk(requirement)) throw new Error('requirement');
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });

    const agentAcc = await provisionAccount(db, { email: 'agent-dec@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE', 'COMMENT'],
      purpose: 'review',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });
    await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });

    return {
      account,
      applicantId,
      missionId: mission.value.id,
      packRequirementId: requirement.value.id,
      org,
      agentAcc,
    };
  }

  it('lets an assigned, granted reviewer record and read a decision', async () => {
    const { missionId, packRequirementId, org, agentAcc } = await setUp(db);
    const decided = await recordMissionDecision(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'ACCEPTED',
      reason: 'Matches the applicant record.',
    });
    expect(isOk(decided)).toBe(true);
    if (!isOk(decided)) return;
    expect(decided.value.outcome).toBe('ACCEPTED');

    const list = await listMissionDecisions(db, agentAcc.value.id, missionId);
    expect(isOk(list)).toBe(true);
    if (isOk(list)) {
      expect(list.value).toHaveLength(1);
      expect(list.value[0]?.outcome).toBe('ACCEPTED');
    }
  });

  it('refuses to let the mission owner record a decision on their own mission (not self-attestation)', async () => {
    const { account, missionId, packRequirementId, org } = await setUp(db);
    const decided = await recordMissionDecision(db, {
      actorAccountId: account.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'ACCEPTED',
    });
    expect(isErr(decided)).toBe(true);
    if (isErr(decided)) expect(decided.error.code).toBe('forbidden');
  });

  it('refuses a granted-but-unassigned org member', async () => {
    const { missionId, packRequirementId, org, agentAcc } = await setUp(db);
    const unassigned = await provisionAccount(db, { email: 'unassigned-dec@acme.com' });
    if (!isOk(unassigned)) throw new Error('provision');
    // A genuine, active member of the org — just never assigned to THIS mission.
    const membership = await addMembership(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      accountId: unassigned.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(membership)).toBe(true);
    const decided = await recordMissionDecision(db, {
      actorAccountId: unassigned.value.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'ACCEPTED',
    });
    expect(isErr(decided)).toBe(true);
    if (isErr(decided)) expect(decided.error.code).toBe('forbidden');
  });

  it("refuses a stranger org's member entirely (no grant on this applicant)", async () => {
    const { missionId, packRequirementId } = await setUp(db);
    const strangerAgent = await provisionAccount(db, { email: 'stranger-agent-dec@other.com' });
    if (!isOk(strangerAgent)) throw new Error('provision');
    const strangerOrg = await createOrganization(db, {
      actorAccountId: strangerAgent.value.id,
      name: 'Other Agency',
    });
    if (!isOk(strangerOrg)) throw new Error('org');
    await activateOrg(db, strangerOrg.value.id);

    const decided = await recordMissionDecision(db, {
      actorAccountId: strangerAgent.value.id,
      organizationId: strangerOrg.value.id,
      missionId,
      packRequirementId,
      outcome: 'REJECTED',
    });
    expect(isErr(decided)).toBe(true);
    if (isErr(decided)) expect(decided.error.code).toBe('forbidden');
  });

  it('refuses to read decisions for an account with no standing on the mission', async () => {
    const { missionId } = await setUp(db);
    const stranger = await provisionAccount(db, { email: 'stranger-read-dec@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const list = await listMissionDecisions(db, stranger.value.id, missionId);
    expect(isErr(list)).toBe(true);
    if (isErr(list)) expect(list.error.code).toBe('forbidden');
  });

  it("revokes a former reviewer's access to decision history the instant their membership is deactivated (finding #32)", async () => {
    const { missionId, packRequirementId, org, agentAcc } = await setUp(db);
    await recordMissionDecision(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'ACCEPTED',
    });
    // Still readable while active.
    expect(isOk(await listMissionDecisions(db, agentAcc.value.id, missionId))).toBe(true);

    // Deactivate the reviewer's membership (org OWNER acting on themselves via
    // a second, disposable OWNER — setMembershipActive refuses to deactivate
    // the sole remaining owner).
    const secondOwner = await provisionAccount(db, { email: 'second-owner-dec@acme.com' });
    if (!isOk(secondOwner)) throw new Error('provision');
    await addMembership(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      accountId: secondOwner.value.id,
      role: 'OWNER',
    });
    const membership = (await listMembershipsForAccount(db, agentAcc.value.id))[0];
    if (!membership) throw new Error('membership');
    const deactivated = await setMembershipActive(db, {
      actorAccountId: secondOwner.value.id,
      organizationId: org.value.id,
      membershipId: membership.membershipId,
      active: false,
    });
    expect(isOk(deactivated)).toBe(true);

    // The assignment row still exists, but the former reviewer is no longer
    // an active member — decision history must now be denied, not exposed
    // indefinitely (docs/audits/post-programme-defect-register.md finding #32).
    const list = await listMissionDecisions(db, agentAcc.value.id, missionId);
    expect(isErr(list)).toBe(true);
    if (isErr(list)) expect(list.error.code).toBe('forbidden');
  });
});

describe('scope and read-authorization hardening (post-programme defect register findings #3–#7)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('excludes revoked, paused, and unaccepted grants from listApplicantsForOrganization (finding #3)', async () => {
    const agentAcc = await provisionAccount(db, { email: 'agent-scope@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const revoked = await consentedApplicant(db, 'revoked-scope@example.com');
    const revokedGrant = await createGrant(db, {
      actorAccountId: revoked.account.id,
      applicantId: revoked.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(revokedGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: revokedGrant.value.id });
    await revokeGrant(db, { actorAccountId: revoked.account.id, grantId: revokedGrant.value.id });

    const paused = await consentedApplicant(db, 'paused-scope@example.com');
    const pausedGrant = await createGrant(db, {
      actorAccountId: paused.account.id,
      applicantId: paused.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(pausedGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: pausedGrant.value.id });
    await pauseGrant(db, { actorAccountId: paused.account.id, grantId: pausedGrant.value.id });

    const unaccepted = await consentedApplicant(db, 'unaccepted-scope@example.com');
    await createGrant(db, {
      actorAccountId: unaccepted.account.id,
      applicantId: unaccepted.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });

    const active = await consentedApplicant(db, 'active-scope@example.com');
    const activeGrant = await createGrant(db, {
      actorAccountId: active.account.id,
      applicantId: active.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(activeGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: activeGrant.value.id });

    const applicants = await listApplicantsForOrganization(db, org.value.id);
    expect(applicants).toHaveLength(1);
    expect(applicants[0]?.applicantId).toBe(active.applicantId);
  });

  it('never lets a mission-scoped bulk export reach beyond its scope (finding #4)', async () => {
    const agentAcc = await provisionAccount(db, { email: 'agent-bulkscope@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const orgId = org.value.id;

    const { account, applicantId } = await consentedApplicant(db, 'bulkscope@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');

    // A mission-scoped grant is the ONLY standing this org has for this
    // applicant — it must never be evaluated as applicant-wide.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: orgId,
      missionId: mission.value.id,
      actions: ['EXPORT_PROFILE'],
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const exported = await bulkExport(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: orgId,
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    expect(isOk(exported)).toBe(true);
    if (!isOk(exported)) return;
    // EXPORT_PROFILE is a profile-wide action with no mission-scoped
    // equivalent in the policy engine — a genuinely mission-scoped grant
    // must never authorize it at all once scope is correctly preserved.
    expect(exported.value).toHaveLength(0);
  });

  it('denies notes/assignments once the org grant does not permit COMMENT or MANAGE on that mission (finding #5)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'readscope@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-readscope@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // Applicant-wide grant, but scoped only to PREVIEW — no COMMENT, no MANAGE.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    // The mission is visible via listMissionsForOrganization (a real, active,
    // accepted grant exists)...
    const missions = await listMissionsForOrganization(db, org.value.id);
    expect(missions).toHaveLength(1);

    // ...but notes/assignments must not be readable without COMMENT/MANAGE.
    expect(await listNotes(db, org.value.id, applicantId, mission.value.id)).toHaveLength(0);
    expect(
      await listAssignmentsDetailed(db, org.value.id, applicantId, mission.value.id),
    ).toHaveLength(0);
  });

  it('honors a mission-scoped MANAGE grant when requesting evidence (finding #6)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'evscope@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-evscope@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // The ONLY grant is mission-scoped — no applicant-wide grant exists.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE'],
      purpose: 'review',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    // Without the mission id, this must fail (scope_mismatch) — proving the
    // regression this test guards against.
    const withoutScope = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
    });
    expect(isErr(withoutScope)).toBe(true);

    // Supplying the mission id lets the mission-scoped grant match.
    const withScope = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      missionId: mission.value.id,
    });
    expect(isOk(withScope)).toBe(true);
  });

  it('deduplicates a mission reachable via both an applicant-wide and a mission-scoped grant (finding #7)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'dedupe@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-dedupe@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const wideGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review-wide',
    });
    if (!isOk(wideGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: wideGrant.value.id });

    const scopedGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['COMMENT'],
      purpose: 'review-scoped',
    });
    if (!isOk(scopedGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: scopedGrant.value.id });

    const missions = await listMissionsForOrganization(db, org.value.id);
    expect(missions).toHaveLength(1);
    expect(missions[0]?.missionId).toBe(mission.value.id);
  });
});
