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
  ACKNOWLEDGEMENT_TEXT_VERSION,
  decideAcknowledgement,
  getLiveAcknowledgement,
  listAcknowledgementsForMission,
} from './acknowledgements';
import { addFamilyMember, createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  attachPackVersion,
  createMission,
  selectEvidence,
  snapshotMission,
  updateMissionCaseDetails,
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

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seed(db: Db) {
  const p = await provisionAccount(db, { email: 'ack@example.com' });
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

/** A published pack requiring exactly one FIELD (passport.number). */
async function publishedFieldPack(db: Db, actor: string): Promise<string> {
  const pack = await createPack(db, { actorAccountId: actor, key: 'ack.pack', name: 'Ack Pack' });
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

describe('TRU-02 (Commercial V1 Part 7 §3): acknowledgement entity', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function setUp(db: Db) {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedFieldPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
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
      missionId: mission.value.id,
      packRequirementId: fieldRequirementId,
      factId: fact.value.fact.id,
    });
    if (!isOk(selected)) throw new Error('select');

    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    if (!isOk(snap)) throw new Error('snapshot');

    return {
      account,
      applicantId,
      missionId: mission.value.id,
      snapshotId: snap.value.id,
      checksum: snap.value.checksum,
      factId: fact.value.fact.id,
    };
  }

  it('acknowledges a prepared file: SELF applicant, no reason needed, every directive-named field recorded', async () => {
    const { account, applicantId, missionId, snapshotId, checksum } = await setUp(db);

    const result = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.missionId).toBe(missionId);
    expect(result.value.subjectApplicantId).toBe(applicantId);
    expect(result.value.snapshotId).toBe(snapshotId);
    expect(result.value.snapshotChecksum).toBe(checksum);
    expect(result.value.caseMaterialRevision).toBe(3); // 1 (create) + attachPackVersion + selectEvidence
    expect(result.value.decision).toBe('ACKNOWLEDGED');
    expect(result.value.reason).toBeNull();
    expect(result.value.actorAccountId).toBe(account.id);
    expect(result.value.actorAuthority).toBe('SELF');
    expect(result.value.textVersion).toBe(ACKNOWLEDGEMENT_TEXT_VERSION);
    expect(result.value.authAssuranceContext).toMatchObject({ method: 'step_up' });
    expect(result.value.invalidatedAt).toBeNull();
    expect(result.value.createdAt).toBeInstanceOf(Date);
  });

  it('a guardian acknowledges for a represented applicant: actor is the guardian, subject is the dependant, authority is recorded honestly', async () => {
    const { account } = await seed(db);
    const dependant = await addFamilyMember(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Child',
      relationship: 'MINOR_GUARDIAN',
      authorityConfirmed: true,
    });
    if (!isOk(dependant)) throw new Error('dependant');

    const packVersionId = await publishedFieldPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId: dependant.value.id,
      title: "Child's visa",
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' }).catch(
      () => {},
    );
    const fact = await editFact(db, {
      actorAccountId: account.id,
      applicantId: dependant.value.id,
      fieldKey: 'passport.number',
      value: 'B1',
    });
    if (!isOk(fact)) throw new Error('fact');
    const requirements = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, packVersionId));
    const fieldRequirementId = requirements[0]?.id;
    if (!fieldRequirementId) throw new Error('requirement');
    await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packRequirementId: fieldRequirementId,
      factId: fact.value.fact.id,
    });
    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    if (!isOk(snap)) throw new Error('snapshot');

    const result = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      snapshotId: snap.value.id,
      expectedSnapshotChecksum: snap.value.checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.actorAccountId).toBe(account.id);
    expect(result.value.subjectApplicantId).toBe(dependant.value.id);
    expect(result.value.actorAuthority).toBe('MINOR_GUARDIAN');
  });

  it("refuses an org member acknowledging merely because they manage the case, even with a MANAGE grant (directive §3: 'cannot acknowledge for applicant merely because they manage the case')", async () => {
    const { account, applicantId, missionId, snapshotId, checksum } = await setUp(db);
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'SHARING',
      granted: true,
    });

    const agent = await provisionAccount(db, { email: 'ack-agent@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'ack-admin@example.com' });
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

    const result = await decideAcknowledgement(db, {
      actorAccountId: agent.value.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('refuses without step-up, even for the genuine owner', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);
    const result = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: false,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('step_up_required');
  });

  it('requires a reason to reject or request a correction, but not to acknowledge', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);

    const rejectNoReason = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'REJECTED',
      stepUpSatisfied: true,
    });
    expect(isErr(rejectNoReason)).toBe(true);
    if (isErr(rejectNoReason)) expect(rejectNoReason.error.code).toBe('invalid');

    const correctionNoReason = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'CORRECTION_REQUESTED',
      stepUpSatisfied: true,
      reason: '   ',
    });
    expect(isErr(correctionNoReason)).toBe(true);
    if (isErr(correctionNoReason)) expect(correctionNoReason.error.code).toBe('invalid');

    const acknowledgeNoReason = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isOk(acknowledgeNoReason)).toBe(true);
  });

  it('fails as stale when the caller\'s checksum no longer matches the snapshot (directive §4: "check snapshot hash")', async () => {
    const { account, missionId, snapshotId } = await setUp(db);
    const result = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: 'not-the-real-checksum',
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('stale');
  });

  it('fails as stale when the case has materially changed since the snapshot was taken (directive §4: "lock/check same revision")', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);

    const bump = await updateMissionCaseDetails(db, {
      actorAccountId: account.id,
      missionId,
      jurisdiction: 'UK',
    });
    expect(isOk(bump)).toBe(true);

    const result = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('stale');
  });

  it('is idempotent: repeating the same decision on the same still-current snapshot returns the original row, not a duplicate', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);

    const first = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;

    const second = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.id).toBe(first.value.id);

    const rows = await db
      .select()
      .from(schema.acknowledgements)
      .where(eq(schema.acknowledgements.snapshotId, snapshotId));
    expect(rows).toHaveLength(1);
  });

  it('rejecting then later acknowledging the SAME still-current snapshot creates two distinct historical rows', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);

    const rejected = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'REJECTED',
      reason: 'the destination looks wrong',
      stepUpSatisfied: true,
    });
    expect(isOk(rejected)).toBe(true);

    const acknowledged = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isOk(acknowledged)).toBe(true);
    if (!isOk(rejected) || !isOk(acknowledged)) return;
    expect(acknowledged.value.id).not.toBe(rejected.value.id);

    const rows = await db
      .select()
      .from(schema.acknowledgements)
      .where(eq(schema.acknowledgements.snapshotId, snapshotId));
    expect(rows).toHaveLength(2);
  });

  it('a later material change invalidates a live ACKNOWLEDGED row (TRU-03 §4 "acknowledgement invalidation"), but never a REJECTED/CORRECTION_REQUESTED one', async () => {
    const { account, applicantId, missionId, snapshotId, checksum } = await setUp(db);

    const acknowledged = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isOk(acknowledged)).toBe(true);
    if (!isOk(acknowledged)) return;
    // A rejection can coexist on the same snapshot (a genuinely different
    // decision, per the earlier idempotency test) -- it must never look
    // "invalidated" either, since it was never a valid green light at all.
    const rejected = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'REJECTED',
      reason: 'recorded for this test only',
      stepUpSatisfied: true,
    });
    expect(isOk(rejected)).toBe(true);
    if (!isOk(rejected)) return;

    expect(await getLiveAcknowledgement(db, missionId)).toBeDefined();

    // The selected fact is edited -- material (TRU-03: "selected fact
    // value/version"), even though the selection row itself never changes.
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A2',
    });
    expect(isOk(edited)).toBe(true);

    const rows = await db
      .select()
      .from(schema.acknowledgements)
      .where(eq(schema.acknowledgements.snapshotId, snapshotId));
    const ackRow = rows.find((r) => r.id === acknowledged.value.id);
    const rejRow = rows.find((r) => r.id === rejected.value.id);
    expect(ackRow?.invalidatedAt).not.toBeNull();
    expect(rejRow?.invalidatedAt).toBeNull();
    expect(await getLiveAcknowledgement(db, missionId)).toBeUndefined();
  });

  it('getLiveAcknowledgement tracks the latest valid ACKNOWLEDGED snapshot across a reject -> new-snapshot -> acknowledge cycle', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);

    const rejected = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'REJECTED',
      reason: 'not ready yet',
      stepUpSatisfied: true,
    });
    expect(isOk(rejected)).toBe(true);
    expect(await getLiveAcknowledgement(db, missionId)).toBeUndefined();

    const snap2 = await snapshotMission(db, { actorAccountId: account.id, missionId });
    if (!isOk(snap2)) throw new Error('snapshot');
    const acknowledged = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId: snap2.value.id,
      expectedSnapshotChecksum: snap2.value.checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isOk(acknowledged)).toBe(true);
    if (!isOk(acknowledged)) return;

    const live = await getLiveAcknowledgement(db, missionId);
    expect(live?.id).toBe(acknowledged.value.id);
    expect(live?.snapshotId).toBe(snap2.value.id);
  });

  it('listAcknowledgementsForMission is owner-scoped and returns newest first', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);
    await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'REJECTED',
      reason: 'first pass',
      stepUpSatisfied: true,
    });
    await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });

    const list = await listAcknowledgementsForMission(db, account.id, missionId);
    expect(isOk(list)).toBe(true);
    if (!isOk(list)) return;
    expect(list.value).toHaveLength(2);
    expect(list.value[0]?.decision).toBe('ACKNOWLEDGED');
    expect(list.value[1]?.decision).toBe('REJECTED');

    const stranger = await provisionAccount(db, { email: 'ack-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await listAcknowledgementsForMission(db, stranger.value.id, missionId);
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');
  });

  describe('OPS-04 analytics', () => {
    async function events(type: 'ACKNOWLEDGEMENT_RECORDED' | 'ACKNOWLEDGEMENT_INVALIDATED') {
      return (await db.select().from(schema.productEvents)).filter((e) => e.eventType === type);
    }

    it('records which decision the applicant took, for every decision the database allows, and never the reason they gave', async () => {
      const { account, missionId, snapshotId, checksum } = await setUp(db);
      const reason = 'My surname is misspelt and the embassy in Dhaka will bounce it';
      const decisions = schema.acknowledgementDecision.enumValues;
      for (const decision of decisions) {
        const result = await decideAcknowledgement(db, {
          actorAccountId: account.id,
          missionId,
          snapshotId,
          expectedSnapshotChecksum: checksum,
          decision,
          stepUpSatisfied: true,
          ...(decision === 'ACKNOWLEDGED' ? {} : { reason }),
        });
        expect(isOk(result), decision).toBe(true);
      }

      const recorded = await events('ACKNOWLEDGEMENT_RECORDED');
      expect(recorded.map((e) => e.dimension).sort()).toEqual([...decisions].sort());
      for (const event of recorded) {
        expect(event).toMatchObject({
          accountId: account.id,
          organizationId: null,
          metricValue: null,
        });
        const stored = JSON.stringify(event);
        for (const leaked of ['surname', 'misspelt', 'embassy', 'Dhaka']) {
          expect(stored).not.toContain(leaked);
        }
      }
    });

    it('records a repeated decision once, because the repeat changes nothing', async () => {
      const { account, missionId, snapshotId, checksum } = await setUp(db);
      for (let i = 0; i < 3; i++) {
        await decideAcknowledgement(db, {
          actorAccountId: account.id,
          missionId,
          snapshotId,
          expectedSnapshotChecksum: checksum,
          decision: 'ACKNOWLEDGED',
          stepUpSatisfied: true,
        });
      }
      expect(await events('ACKNOWLEDGEMENT_RECORDED')).toHaveLength(1);
    });

    it('records nothing for a decision that is refused', async () => {
      const { account, missionId, snapshotId, checksum } = await setUp(db);
      const noStepUp = await decideAcknowledgement(db, {
        actorAccountId: account.id,
        missionId,
        snapshotId,
        expectedSnapshotChecksum: checksum,
        decision: 'ACKNOWLEDGED',
        stepUpSatisfied: false,
      });
      const noReason = await decideAcknowledgement(db, {
        actorAccountId: account.id,
        missionId,
        snapshotId,
        expectedSnapshotChecksum: checksum,
        decision: 'REJECTED',
        stepUpSatisfied: true,
      });
      const stale = await decideAcknowledgement(db, {
        actorAccountId: account.id,
        missionId,
        snapshotId,
        expectedSnapshotChecksum: 'not-the-checksum',
        decision: 'ACKNOWLEDGED',
        stepUpSatisfied: true,
      });
      expect([isErr(noStepUp), isErr(noReason), isErr(stale)]).toEqual([true, true, true]);
      expect(await events('ACKNOWLEDGEMENT_RECORDED')).toEqual([]);
    });

    it('records an invalidation when a material change voids a live acknowledgement, and only then', async () => {
      const { account, applicantId, missionId, snapshotId, checksum } = await setUp(db);
      await decideAcknowledgement(db, {
        actorAccountId: account.id,
        missionId,
        snapshotId,
        expectedSnapshotChecksum: checksum,
        decision: 'ACKNOWLEDGED',
        stepUpSatisfied: true,
      });
      expect(await events('ACKNOWLEDGEMENT_INVALIDATED')).toEqual([]);

      const edit = (value: string) =>
        editFact(db, {
          actorAccountId: account.id,
          applicantId,
          fieldKey: 'passport.number',
          value,
        });
      expect(isOk(await edit('A2'))).toBe(true);
      const afterFirstChange = await events('ACKNOWLEDGEMENT_INVALIDATED');
      expect(afterFirstChange).toHaveLength(1);
      // No account: the change may have been a person's edit or the expiry sweep.
      expect(afterFirstChange[0]).toMatchObject({
        accountId: null,
        organizationId: null,
        dimension: null,
        metricValue: null,
      });

      // The acknowledgement is already void; a second change has nothing to void.
      expect(isOk(await edit('A3'))).toBe(true);
      expect(await events('ACKNOWLEDGEMENT_INVALIDATED')).toHaveLength(1);
    });

    it('records no invalidation for a case that was never acknowledged, or whose only decision was a rejection', async () => {
      const { account, applicantId, missionId, snapshotId } = await setUp(db);
      const edit = (value: string) =>
        editFact(db, {
          actorAccountId: account.id,
          applicantId,
          fieldKey: 'passport.number',
          value,
        });
      expect(isOk(await edit('A2'))).toBe(true);
      expect(await events('ACKNOWLEDGEMENT_INVALIDATED')).toEqual([]);

      // Take a fresh snapshot of the changed case and reject it: a rejection was
      // never a valid green light, so a later change voids nothing.
      const snap = await snapshotMission(db, { actorAccountId: account.id, missionId });
      if (!isOk(snap)) throw new Error('snapshot');
      expect(snap.value.id).not.toBe(snapshotId);
      const rejected = await decideAcknowledgement(db, {
        actorAccountId: account.id,
        missionId,
        snapshotId: snap.value.id,
        expectedSnapshotChecksum: snap.value.checksum,
        decision: 'REJECTED',
        reason: 'not right yet',
        stepUpSatisfied: true,
      });
      expect(isOk(rejected)).toBe(true);
      expect(isOk(await edit('A3'))).toBe(true);
      expect(await events('ACKNOWLEDGEMENT_INVALIDATED')).toEqual([]);
    });
  });
});
