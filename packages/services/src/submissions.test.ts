import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { decideAcknowledgement } from './acknowledgements';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  attachPackVersion,
  createMission,
  selectEvidence,
  snapshotMission,
  transitionMission,
} from './missions';
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
import { listSubmissionsForMission, recordSubmission } from './submissions';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seed(db: Db) {
  const p = await provisionAccount(db, { email: 'sub@example.com' });
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

async function publishedFieldPack(db: Db, actor: string): Promise<string> {
  const pack = await createPack(db, { actorAccountId: actor, key: 'sub.pack', name: 'Sub Pack' });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  await addRequirement(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
    kind: 'FIELD',
    fieldKey: 'passport.number',
    citation: 'rule 1',
  });
  await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  return version.value.id;
}

describe('TRU-04 (Commercial V1 Part 7 §7): external submission report', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  /** Drives a fresh mission all the way to SUBMISSION_READY with a live acknowledgement. */
  async function setUp(db: Db) {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedFieldPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    const missionId = mission.value.id;
    await attachPackVersion(db, { actorAccountId: account.id, missionId, packVersionId });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const fact = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    if (!isOk(fact)) throw new Error('fact');

    const requirements = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, packVersionId));
    const fieldRequirementId = requirements[0]?.id;
    if (!fieldRequirementId) throw new Error('requirement');

    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId: fact.value.fact.id,
    });
    if (!isOk(selected)) throw new Error('select');

    const snap = await snapshotMission(db, { actorAccountId: account.id, missionId });
    if (!isOk(snap)) throw new Error('snapshot');

    const ack = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId: snap.value.id,
      expectedSnapshotChecksum: snap.value.checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    if (!isOk(ack)) throw new Error('acknowledge');

    for (const to of ['INTAKE', 'IN_REVIEW', 'AWAITING_APPLICANT', 'SUBMISSION_READY'] as const) {
      const moved = await transitionMission(db, { actorAccountId: account.id, missionId, to });
      if (!isOk(moved)) throw new Error(`transition to ${to}`);
    }

    return {
      account,
      applicantId,
      missionId,
      snapshotId: snap.value.id,
      factId: fact.value.fact.id,
    };
  }

  it('records a submission report and moves a submission-ready case to SUBMITTED, referencing the live-acknowledged snapshot as the packet', async () => {
    const { account, missionId, snapshotId } = await setUp(db);

    const result = await recordSubmission(db, {
      actorAccountId: account.id,
      missionId,
      channel: 'EMBASSY_PORTAL',
      externalReportDescription: 'Confirmation email from embassy portal, ref #12345',
      externalReference: '12345',
      stepUpSatisfied: true,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.missionId).toBe(missionId);
    expect(result.value.snapshotId).toBe(snapshotId);
    expect(result.value.actorAccountId).toBe(account.id);
    expect(result.value.channel).toBe('EMBASSY_PORTAL');
    expect(result.value.externalReportDescription).toContain('embassy portal');
    expect(result.value.externalReference).toBe('12345');
    expect(result.value.submittedAt).toBeInstanceOf(Date);
    expect(result.value.authAssuranceContext).toMatchObject({ method: 'step_up' });

    const mission = (
      await db.select().from(schema.missions).where(eq(schema.missions.id, missionId))
    )[0];
    expect(mission?.state).toBe('SUBMITTED');
  });

  it('refuses without step-up, even for the genuine owner', async () => {
    const { account, missionId } = await setUp(db);
    const result = await recordSubmission(db, {
      actorAccountId: account.id,
      missionId,
      channel: 'EMAIL',
      externalReportDescription: 'Sent by email to the visa section',
      stepUpSatisfied: false,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('step_up_required');
  });

  it('refuses a case that is not submission-ready', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Draft case',
    });
    if (!isOk(mission)) throw new Error('mission');

    const result = await recordSubmission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      channel: 'EMAIL',
      externalReportDescription: 'Sent by email',
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('requires a non-empty external report description', async () => {
    const { account, missionId } = await setUp(db);
    const result = await recordSubmission(db, {
      actorAccountId: account.id,
      missionId,
      channel: 'OTHER',
      externalReportDescription: '   ',
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('refuses a submission date/time in the future', async () => {
    const { account, missionId } = await setUp(db);
    const result = await recordSubmission(db, {
      actorAccountId: account.id,
      missionId,
      channel: 'IN_PERSON',
      externalReportDescription: 'Filed in person at the visa center',
      submittedAt: new Date(Date.now() + 60_000),
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it("refuses an org member recording a submission merely because they manage the case, even with a MANAGE grant (mirrors directive §3's acknowledgement rule)", async () => {
    const { account, applicantId, missionId } = await setUp(db);
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'SHARING',
      granted: true,
    });
    const agent = await provisionAccount(db, { email: 'sub-agent@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'sub-admin@example.com' });
    if (!isOk(admin)) throw new Error('provision');
    await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'case_management',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });

    const result = await recordSubmission(db, {
      actorAccountId: agent.value.id,
      missionId,
      channel: 'EMAIL',
      externalReportDescription: 'Sent by the agency',
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('fails as stale when the live acknowledgement was invalidated by a material change after the case reached submission-ready (directive §4 re-check, applied to issuance)', async () => {
    const { account, applicantId, missionId } = await setUp(db);

    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A2',
    });
    expect(isOk(edited)).toBe(true);

    const result = await recordSubmission(db, {
      actorAccountId: account.id,
      missionId,
      channel: 'EMAIL',
      externalReportDescription: 'Sent by email',
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('stale');

    const mission = (
      await db.select().from(schema.missions).where(eq(schema.missions.id, missionId))
    )[0];
    expect(mission?.state).toBe('SUBMISSION_READY');
  });

  it('a generic transitionMission call can never reach SUBMITTED directly -- recordSubmission is the only path', async () => {
    const { account, missionId } = await setUp(db);
    const result = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'SUBMITTED',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('listSubmissionsForMission is owner-scoped and returns newest first', async () => {
    const { account, missionId } = await setUp(db);
    await recordSubmission(db, {
      actorAccountId: account.id,
      missionId,
      channel: 'EMAIL',
      externalReportDescription: 'First attempt, by email',
      stepUpSatisfied: true,
    });

    const list = await listSubmissionsForMission(db, account.id, missionId);
    expect(isOk(list)).toBe(true);
    if (!isOk(list)) return;
    expect(list.value).toHaveLength(1);
    expect(list.value[0]?.channel).toBe('EMAIL');

    const stranger = await provisionAccount(db, { email: 'sub-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await listSubmissionsForMission(db, stranger.value.id, missionId);
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');
  });
});
