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
  listNotes,
  requestEvidence,
  respondEvidence,
} from './agency';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission } from './missions';
import { createOrganization } from './organizations';
import { editFact, registerFieldDefinition } from './profile';
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
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { account, applicantId: applicant.value.id };
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
    const stranger = await provisionAccount(db, { email: 'stranger-bulk@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const result = await bulkExport(db, {
      actorAccountId: stranger.value.id,
      organizationId: org.value.id,
      purpose: 'bulk',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });
});
