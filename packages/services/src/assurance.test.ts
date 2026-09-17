import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { assignMember, recordMissionDecision } from './agency';
import { createApplicant } from './applicants';
import {
  deriveAssuranceTier,
  getFactAssurance,
  listApplicantAssurance,
  listIssuerVerificationsForDocument,
  recordIssuerVerification,
} from './assurance';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { attachPackVersion, createMission, selectEvidence } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { acceptGrant, createGrant } from './sharing';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seedOwner(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
  const account = provisioned.value;
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
  if (!isOk(applicant)) throw new Error('applicant failed');
  return { account, applicant: applicant.value };
}

/** An active org (ACTIVE status) with `agentAccountId` as its OWNER/admin. */
async function seedActiveOrg(db: Db, agentEmail: string) {
  const agent = await provisionAccount(db, { email: agentEmail });
  if (!isOk(agent)) throw new Error('provision');
  const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme Agency' });
  if (!isOk(org)) throw new Error('org');
  const admin = await provisionAccount(db, { email: `platform-admin-${agentEmail}` });
  if (!isOk(admin)) throw new Error('provision');
  await reviewOrganization(db, {
    reviewerAccountId: admin.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  return { agent: agent.value, organization: org.value };
}

async function grantOrg(
  db: Db,
  input: {
    readonly ownerAccountId: string;
    readonly applicantId: string;
    readonly organizationId: string;
    readonly agentAccountId: string;
    readonly actions: readonly ('COMMENT' | 'MANAGE')[];
  },
) {
  const grant = await createGrant(db, {
    actorAccountId: input.ownerAccountId,
    applicantId: input.applicantId,
    recipientOrganizationId: input.organizationId,
    actions: [...input.actions],
    purpose: 'agency_review',
  });
  if (!isOk(grant)) throw new Error('grant');
  await acceptGrant(db, { actorAccountId: input.agentAccountId, grantId: grant.value.id });
  return grant.value;
}

describe('deriveAssuranceTier (EVI-05)', () => {
  it('is E0 for a bare declaration with nothing else', () => {
    expect(
      deriveAssuranceTier({
        documentSupplied: false,
        hasMachineCheck: false,
        hasAgencyReview: false,
        hasLiveIssuerConfirmation: false,
      }),
    ).toBe('E0');
  });

  it('is E1 once a document backs the claim, with no checks or review yet', () => {
    expect(
      deriveAssuranceTier({
        documentSupplied: true,
        hasMachineCheck: false,
        hasAgencyReview: false,
        hasLiveIssuerConfirmation: false,
      }),
    ).toBe('E1');
  });

  it('is E2 with a document plus a machine check, and separately with a document plus an agency review', () => {
    expect(
      deriveAssuranceTier({
        documentSupplied: true,
        hasMachineCheck: true,
        hasAgencyReview: false,
        hasLiveIssuerConfirmation: false,
      }),
    ).toBe('E2');
    expect(
      deriveAssuranceTier({
        documentSupplied: true,
        hasMachineCheck: false,
        hasAgencyReview: true,
        hasLiveIssuerConfirmation: false,
      }),
    ).toBe('E2');
  });

  it('never reaches E2 without a document, even with a check or an agency review (never proof of authenticity)', () => {
    expect(
      deriveAssuranceTier({
        documentSupplied: false,
        hasMachineCheck: true,
        hasAgencyReview: true,
        hasLiveIssuerConfirmation: false,
      }),
    ).not.toBe('E2');
  });

  it('an agency review with no document is still real progress over a bare declaration: E1, not E0', () => {
    expect(
      deriveAssuranceTier({
        documentSupplied: false,
        hasMachineCheck: false,
        hasAgencyReview: true,
        hasLiveIssuerConfirmation: false,
      }),
    ).toBe('E1');
  });

  it('is E0 with nothing but a hypothetical check and no document or review (checks never occur without a document in practice)', () => {
    expect(
      deriveAssuranceTier({
        documentSupplied: false,
        hasMachineCheck: true,
        hasAgencyReview: false,
        hasLiveIssuerConfirmation: false,
      }),
    ).toBe('E0');
  });

  it('is E3 only with a live issuer confirmation; an expired one does not count', () => {
    expect(
      deriveAssuranceTier({
        documentSupplied: true,
        hasMachineCheck: true,
        hasAgencyReview: true,
        hasLiveIssuerConfirmation: true,
      }),
    ).toBe('E3');
    expect(
      deriveAssuranceTier({
        documentSupplied: true,
        hasMachineCheck: true,
        hasAgencyReview: true,
        hasLiveIssuerConfirmation: false,
      }),
    ).toBe('E2');
  });
});

describe('getFactAssurance / listApplicantAssurance (EVI-05)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('shows a declared-only fact as E0: declared, no document, no checks, no review, no issuer', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-e0@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
    });
    if (!isOk(edited)) throw new Error('edit');

    const view = await getFactAssurance(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
    });
    expect(isOk(view)).toBe(true);
    if (!isOk(view)) return;
    expect(view.value.applicantDeclared).toBe(true);
    expect(view.value.documentSupplied).toBe(false);
    expect(view.value.machineChecks).toEqual([]);
    expect(view.value.agencyReviews).toEqual([]);
    expect(view.value.issuerConfirmations).toEqual([]);
    expect(view.value.tier).toBe('E0');
  });

  it('denies a non-owner and reports not_found for an unknown fact', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-denied@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
    });
    if (!isOk(edited)) throw new Error('edit');

    const stranger = await provisionAccount(db, { email: 'assurance-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await getFactAssurance(db, {
      actorAccountId: stranger.value.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');

    const missing = await getFactAssurance(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      factId: '00000000-0000-0000-0000-000000000000',
    });
    expect(isErr(missing)).toBe(true);
    if (isErr(missing)) expect(missing.error.code).toBe('not_found');
  });

  it('surfaces named machine checks (scan, extraction, classification) once a document backs the fact, reaching E2', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-checks@example.com');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(doc)) throw new Error('doc');
    const added = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'assurance-checks-key',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(added)) throw new Error('version');
    const versionId = added.value.version.id;

    await db.insert(schema.documentScanResults).values({
      documentVersionId: versionId,
      scannerName: 'clamav',
      scannerVersion: '1.0',
      safe: true,
    });
    const [run] = await db
      .insert(schema.processingRuns)
      .values({ documentVersionId: versionId, pipelineVersion: '1.0.0', status: 'COMPLETED' })
      .returning();
    const [extraction] = await db
      .insert(schema.extractionRuns)
      .values({
        processingRunId: (run as { id: string }).id,
        documentVersionId: versionId,
        parserName: 'mrz',
        parserVersion: '1.0',
        status: 'SUCCEEDED',
      })
      .returning();
    await db.insert(schema.documentClassifications).values({
      extractionRunId: (extraction as { id: string }).id,
      documentVersionId: versionId,
      classifiedType: 'PASSPORT',
      confidence: 92,
      reviewRequired: false,
      rationale: 'MRZ present and valid',
    });

    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
      status: 'DOCUMENT_SUPPORTED',
      method: 'DOCUMENT',
      sourceDocumentVersionId: versionId,
    });
    if (!isOk(edited)) throw new Error('edit');

    const view = await getFactAssurance(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
    });
    expect(isOk(view)).toBe(true);
    if (!isOk(view)) return;
    expect(view.value.documentSupplied).toBe(true);
    expect(view.value.machineChecks).toHaveLength(3);
    expect(view.value.machineChecks.every((c) => c.passed)).toBe(true);
    expect(view.value.tier).toBe('E2');
  });

  it('surfaces an accepted agency decision as an agency review, reaching E1 (no document backs this fact)', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-agency@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
    });
    if (!isOk(edited)) throw new Error('edit');

    const pack = await createPack(db, {
      actorAccountId: account.id,
      key: 'agency.pack',
      name: 'P',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const requirement = await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'rule 1',
    });
    if (!isOk(requirement)) throw new Error('requirement');
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });

    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });
    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packRequirementId: requirement.value.id,
      factId: edited.value.fact.id,
    });
    expect(isOk(selected)).toBe(true);

    const { agent, organization } = await seedActiveOrg(db, 'assurance-agency-agent@example.com');
    await grantOrg(db, {
      ownerAccountId: account.id,
      applicantId: applicant.id,
      organizationId: organization.id,
      agentAccountId: agent.id,
      actions: ['MANAGE'],
    });
    const assigned = await assignMember(db, {
      actorAccountId: agent.id,
      organizationId: organization.id,
      memberAccountId: agent.id,
      missionId: mission.value.id,
    });
    expect(isOk(assigned)).toBe(true);
    const decided = await recordMissionDecision(db, {
      actorAccountId: agent.id,
      organizationId: organization.id,
      missionId: mission.value.id,
      packRequirementId: requirement.value.id,
      outcome: 'ACCEPTED',
      reason: 'Matches the passport on file.',
    });
    expect(isOk(decided)).toBe(true);

    const view = await getFactAssurance(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
    });
    expect(isOk(view)).toBe(true);
    if (!isOk(view)) return;
    expect(view.value.agencyReviews).toHaveLength(1);
    expect(view.value.agencyReviews[0]?.outcome).toBe('ACCEPTED');
    expect(view.value.agencyReviews[0]?.missionId).toBe(mission.value.id);
    expect(view.value.documentSupplied).toBe(false);
    expect(view.value.tier).toBe('E1');
  });

  it('lists every fact for an applicant in one batch', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-batch@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'employer.name', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'employer.name',
      value: 'Acme Corp',
    });

    const all = await listApplicantAssurance(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
    });
    expect(isOk(all)).toBe(true);
    if (!isOk(all)) return;
    expect(all.value).toHaveLength(2);
    expect(all.value.every((v) => v.tier === 'E0')).toBe(true);
  });
});

describe('recordIssuerVerification (EVI-05)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('lets an org member with a MANAGE grant record a live issuer confirmation, reaching E3', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-issuer@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
    });
    if (!isOk(edited)) throw new Error('edit');

    const { agent, organization } = await seedActiveOrg(db, 'assurance-issuer-agent@example.com');
    await grantOrg(db, {
      ownerAccountId: account.id,
      applicantId: applicant.id,
      organizationId: organization.id,
      agentAccountId: agent.id,
      actions: ['MANAGE'],
    });

    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const recorded = await recordIssuerVerification(db, {
      actorAccountId: agent.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
      issuerIdentity: 'HM Passport Office',
      contactMethod: 'phone: +44 300 222 0000',
      exactClaim: 'Passport A123456 is genuine and currently valid.',
      response: 'Confirmed valid, no flags on record.',
      validUntil,
    });
    expect(isOk(recorded)).toBe(true);

    const view = await getFactAssurance(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
    });
    expect(isOk(view)).toBe(true);
    if (!isOk(view)) return;
    expect(view.value.issuerConfirmations).toHaveLength(1);
    expect(view.value.issuerConfirmations[0]?.expired).toBe(false);
    expect(view.value.tier).toBe('E3');
  });

  it('an expired issuer confirmation is still shown but does not count toward E3', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-issuer-expired@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
    });
    if (!isOk(edited)) throw new Error('edit');

    const { agent, organization } = await seedActiveOrg(
      db,
      'assurance-issuer-expired-agent@example.com',
    );
    await grantOrg(db, {
      ownerAccountId: account.id,
      applicantId: applicant.id,
      organizationId: organization.id,
      agentAccountId: agent.id,
      actions: ['MANAGE'],
    });

    const soon = new Date(Date.now() + 60 * 1000);
    const recorded = await recordIssuerVerification(db, {
      actorAccountId: agent.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
      issuerIdentity: 'HM Passport Office',
      contactMethod: 'phone',
      exactClaim: 'Passport A123456 is genuine.',
      response: 'Confirmed.',
      validUntil: soon,
    });
    expect(isOk(recorded)).toBe(true);

    // Force it into the past without going through a public mutator: this
    // table is otherwise append-only by contract, but the "expired" branch
    // needs a row that has actually expired to exercise it.
    await db
      .update(schema.issuerVerifications)
      .set({ validUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.issuerVerifications.factId, edited.value.fact.id));

    const view = await getFactAssurance(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
    });
    expect(isOk(view)).toBe(true);
    if (!isOk(view)) return;
    expect(view.value.issuerConfirmations).toHaveLength(1);
    expect(view.value.issuerConfirmations[0]?.expired).toBe(true);
    expect(view.value.tier).not.toBe('E3');
  });

  it('rejects a verification that names neither a fact nor a document', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-issuer-neither@example.com');
    const { agent, organization } = await seedActiveOrg(
      db,
      'assurance-issuer-neither-agent@example.com',
    );
    await grantOrg(db, {
      ownerAccountId: account.id,
      applicantId: applicant.id,
      organizationId: organization.id,
      agentAccountId: agent.id,
      actions: ['MANAGE'],
    });

    const result = await recordIssuerVerification(db, {
      actorAccountId: agent.id,
      applicantId: applicant.id,
      issuerIdentity: 'Some Issuer',
      contactMethod: 'phone',
      exactClaim: 'Claim',
      response: 'Response',
      validUntil: new Date(Date.now() + 86_400_000),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('rejects blank substantive fields and a validUntil that is not in the future', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-issuer-blank@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
    });
    if (!isOk(edited)) throw new Error('edit');
    const { agent, organization } = await seedActiveOrg(
      db,
      'assurance-issuer-blank-agent@example.com',
    );
    await grantOrg(db, {
      ownerAccountId: account.id,
      applicantId: applicant.id,
      organizationId: organization.id,
      agentAccountId: agent.id,
      actions: ['MANAGE'],
    });

    const blank = await recordIssuerVerification(db, {
      actorAccountId: agent.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
      issuerIdentity: '   ',
      contactMethod: 'phone',
      exactClaim: 'Claim',
      response: 'Response',
      validUntil: new Date(Date.now() + 86_400_000),
    });
    expect(isErr(blank)).toBe(true);
    if (isErr(blank)) expect(blank.error.code).toBe('invalid');

    const pastDated = await recordIssuerVerification(db, {
      actorAccountId: agent.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
      issuerIdentity: 'Issuer',
      contactMethod: 'phone',
      exactClaim: 'Claim',
      response: 'Response',
      validUntil: new Date(Date.now() - 1000),
    });
    expect(isErr(pastDated)).toBe(true);
    if (isErr(pastDated)) expect(pastDated.error.code).toBe('invalid');
  });

  it('denies an org that only holds a COMMENT-level grant (MANAGE is required)', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-issuer-comment@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
    });
    if (!isOk(edited)) throw new Error('edit');
    const { agent, organization } = await seedActiveOrg(
      db,
      'assurance-issuer-comment-agent@example.com',
    );
    await grantOrg(db, {
      ownerAccountId: account.id,
      applicantId: applicant.id,
      organizationId: organization.id,
      agentAccountId: agent.id,
      actions: ['COMMENT'],
    });

    const result = await recordIssuerVerification(db, {
      actorAccountId: agent.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
      issuerIdentity: 'Issuer',
      contactMethod: 'phone',
      exactClaim: 'Claim',
      response: 'Response',
      validUntil: new Date(Date.now() + 86_400_000),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('denies the applicant owner themselves: E3 is deliberately never self-certified', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-issuer-owner@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      fieldKey: 'passport.number',
      value: 'A123456',
    });
    if (!isOk(edited)) throw new Error('edit');

    const result = await recordIssuerVerification(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
      issuerIdentity: 'Issuer',
      contactMethod: 'phone',
      exactClaim: 'Claim',
      response: 'Response',
      validUntil: new Date(Date.now() + 86_400_000),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('refuses a fact/document that does not belong to the named applicant', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-issuer-mismatch-a@example.com');
    const other = await seedOwner(db, 'assurance-issuer-mismatch-b@example.com');
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: other.account.id,
      applicantId: other.applicant.id,
      fieldKey: 'passport.number',
      value: 'B999999',
    });
    if (!isOk(edited)) throw new Error('edit');

    const { agent, organization } = await seedActiveOrg(
      db,
      'assurance-issuer-mismatch-agent@example.com',
    );
    await grantOrg(db, {
      ownerAccountId: account.id,
      applicantId: applicant.id,
      organizationId: organization.id,
      agentAccountId: agent.id,
      actions: ['MANAGE'],
    });

    const result = await recordIssuerVerification(db, {
      actorAccountId: agent.id,
      applicantId: applicant.id,
      factId: edited.value.fact.id,
      issuerIdentity: 'Issuer',
      contactMethod: 'phone',
      exactClaim: 'Claim',
      response: 'Response',
      validUntil: new Date(Date.now() + 86_400_000),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('not_found');
  });
});

describe('listIssuerVerificationsForDocument (EVI-05)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('lists confirmations for a document newest first', async () => {
    const { account, applicant } = await seedOwner(db, 'assurance-doc-issuer@example.com');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(doc)) throw new Error('doc');

    const { agent, organization } = await seedActiveOrg(
      db,
      'assurance-doc-issuer-agent@example.com',
    );
    await grantOrg(db, {
      ownerAccountId: account.id,
      applicantId: applicant.id,
      organizationId: organization.id,
      agentAccountId: agent.id,
      actions: ['MANAGE'],
    });

    for (const claim of ['first call', 'follow-up call']) {
      const result = await recordIssuerVerification(db, {
        actorAccountId: agent.id,
        applicantId: applicant.id,
        documentId: doc.value.id,
        issuerIdentity: 'HM Passport Office',
        contactMethod: 'phone',
        exactClaim: claim,
        response: 'Confirmed.',
        validUntil: new Date(Date.now() + 86_400_000),
      });
      expect(isOk(result)).toBe(true);
    }

    const list = await listIssuerVerificationsForDocument(db, doc.value.id);
    expect(list).toHaveLength(2);
    expect(list[0]?.exactClaim).toBe('follow-up call');
    expect(list[1]?.exactClaim).toBe('first call');
  });
});
