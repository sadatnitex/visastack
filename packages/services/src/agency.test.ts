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
  listMissionsForOrganization,
  listNotes,
  requestEvidence,
  respondEvidence,
} from './agency';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission } from './missions';
import { createOrganization, listMembershipsForAccount, reviewOrganization } from './organizations';
import { editFact, registerFieldDefinition } from './profile';
import { RATE_LIMITS } from './rate-limit';
import { acceptGrant, createGrant } from './sharing';

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
    expect(await listNotes(db, mission.value.id)).toHaveLength(1);

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

    const assignments = await listAssignmentsDetailed(db, mission.value.id);
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

  it('lists only applicants who have granted this org something', async () => {
    const a = await consentedApplicant(db, 'orgapp-a@example.com');
    const b = await consentedApplicant(db, 'orgapp-b@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-orgapp@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // A has granted this org something; B has not.
    await createGrant(db, {
      actorAccountId: a.account.id,
      applicantId: a.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    void b;

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
