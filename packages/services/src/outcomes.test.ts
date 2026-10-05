import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { registerDocument } from './documents';
import { createMission } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { listOutcomesForMission, recordOutcome } from './outcomes';
import { acceptGrant, createGrant } from './sharing';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seed(db: Db) {
  const p = await provisionAccount(db, { email: 'outcome@example.com' });
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
  const mission = await createMission(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    title: 'UK Visa',
  });
  if (!isOk(mission)) throw new Error('mission');
  return { account, applicantId: applicant.value.id, missionId: mission.value.id };
}

describe('TRU-04 (Commercial V1 Part 7 §8): case outcome', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('records an outcome with every directive-named field', async () => {
    const { account, missionId } = await seed(db);
    const decisionDate = new Date('2026-01-15T00:00:00Z');

    const result = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'APPROVED',
      decisionDate,
      officialWording: 'Visa granted for the period requested.',
      agencyInterpretation: 'Straightforward approval, no conditions attached.',
      stepUpSatisfied: true,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.missionId).toBe(missionId);
    expect(result.value.decision).toBe('APPROVED');
    expect(result.value.decisionDate.getTime()).toBe(decisionDate.getTime());
    expect(result.value.officialWording).toBe('Visa granted for the period requested.');
    expect(result.value.agencyInterpretation).toBe(
      'Straightforward approval, no conditions attached.',
    );
    expect(result.value.evidenceDocumentId).toBeNull();
    expect(result.value.actorAccountId).toBe(account.id);
    expect(result.value.authAssuranceContext).toMatchObject({ method: 'step_up' });
  });

  it('keeps official wording and agency interpretation as independently stored, never blended', async () => {
    const { account, missionId } = await seed(db);
    const result = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'REFUSED',
      decisionDate: new Date('2026-01-15T00:00:00Z'),
      officialWording: 'Application refused under paragraph 320.',
      stepUpSatisfied: true,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.officialWording).toBe('Application refused under paragraph 320.');
    expect(result.value.agencyInterpretation).toBeNull();
  });

  it('normalizes an empty/whitespace-only optional field to null rather than storing blank text', async () => {
    const { account, missionId } = await seed(db);
    const result = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'OTHER',
      decisionDate: new Date('2026-01-15T00:00:00Z'),
      officialWording: '   ',
      agencyInterpretation: '',
      stepUpSatisfied: true,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.officialWording).toBeNull();
    expect(result.value.agencyInterpretation).toBeNull();
  });

  it('refuses without step-up, even for the genuine owner', async () => {
    const { account, missionId } = await seed(db);
    const result = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'WITHDRAWN',
      decisionDate: new Date(),
      stepUpSatisfied: false,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('step_up_required');
  });

  it('refuses a decision date in the future', async () => {
    const { account, missionId } = await seed(db);
    const result = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'CANCELLED',
      decisionDate: new Date(Date.now() + 60_000),
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('accepts an evidence document belonging to the same case', async () => {
    const { account, applicantId, missionId } = await seed(db);
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'refusal-letter.pdf',
      docType: 'decision_letter',
    });
    if (!isOk(doc)) throw new Error('document');

    const result = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'REFUSED',
      decisionDate: new Date('2026-01-15T00:00:00Z'),
      evidenceDocumentId: doc.value.id,
      stepUpSatisfied: true,
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.evidenceDocumentId).toBe(doc.value.id);
  });

  it("refuses an evidence document that belongs to a different applicant's case", async () => {
    const { account, missionId } = await seed(db);
    const stranger = await provisionAccount(db, { email: 'outcome-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    await setConsent(db, {
      actorAccountId: stranger.value.id,
      accountId: stranger.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const strangerApplicant = await createApplicant(db, {
      actorAccountId: stranger.value.id,
      ownerAccountId: stranger.value.id,
      displayName: 'Stranger',
    });
    if (!isOk(strangerApplicant)) throw new Error('applicant');
    const strangerDoc = await registerDocument(db, {
      actorAccountId: stranger.value.id,
      applicantId: strangerApplicant.value.id,
      originalName: 'not-yours.pdf',
      docType: 'decision_letter',
    });
    if (!isOk(strangerDoc)) throw new Error('document');

    const result = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'REFUSED',
      decisionDate: new Date('2026-01-15T00:00:00Z'),
      evidenceDocumentId: strangerDoc.value.id,
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('not_found');
  });

  it('refuses an org member recording an outcome merely because they manage the case, even with a MANAGE grant', async () => {
    const { account, applicantId, missionId } = await seed(db);
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'SHARING',
      granted: true,
    });
    const agent = await provisionAccount(db, { email: 'outcome-agent@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'outcome-admin@example.com' });
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

    const result = await recordOutcome(db, {
      actorAccountId: agent.value.id,
      missionId,
      decision: 'APPROVED',
      decisionDate: new Date('2026-01-15T00:00:00Z'),
      stepUpSatisfied: true,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('is append-only: a later resubmission outcome does not overwrite an earlier one, and listOutcomesForMission returns newest first', async () => {
    const { account, missionId } = await seed(db);
    const refused = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'REFUSED',
      decisionDate: new Date('2026-01-15T00:00:00Z'),
      stepUpSatisfied: true,
    });
    expect(isOk(refused)).toBe(true);

    const approved = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'APPROVED',
      decisionDate: new Date('2026-03-01T00:00:00Z'),
      stepUpSatisfied: true,
    });
    expect(isOk(approved)).toBe(true);

    const list = await listOutcomesForMission(db, account.id, missionId);
    expect(isOk(list)).toBe(true);
    if (!isOk(list)) return;
    expect(list.value).toHaveLength(2);
    expect(list.value[0]?.decision).toBe('APPROVED');
    expect(list.value[1]?.decision).toBe('REFUSED');

    const stranger = await provisionAccount(db, { email: 'outcome-stranger2@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await listOutcomesForMission(db, stranger.value.id, missionId);
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');
  });
});

describe('OPS-04 (Commercial V1 Part 9): outcome analytics', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function outcomeEvents() {
    return (await db.select().from(schema.productEvents)).filter(
      (e) => e.eventType === 'OUTCOME_RECORDED',
    );
  }

  it('records which decision was reached, and nothing of what the official or agency wording says', async () => {
    const { account, missionId } = await seed(db);
    const result = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'REFUSED',
      decisionDate: new Date('2026-01-15T00:00:00Z'),
      officialWording: 'Refused under paragraph 320(11): previous breach of conditions.',
      agencyInterpretation:
        'Client overstayed in 2019; strong appeal prospects on proportionality.',
      stepUpSatisfied: true,
    });
    expect(isOk(result)).toBe(true);

    const events = await outcomeEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      accountId: account.id,
      organizationId: null,
      dimension: 'REFUSED',
      metricValue: null,
      dedupeKey: null,
    });
    const stored = JSON.stringify(events[0]);
    for (const leaked of ['320', 'breach', 'overstayed', 'appeal', 'proportionality']) {
      expect(stored).not.toContain(leaked);
    }
  });

  it('can label every decision the database allows, so a decision added later is not silently dropped', async () => {
    const { account, missionId } = await seed(db);
    const decisions = schema.missionOutcomeDecision.enumValues;
    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) {
      const result = await recordOutcome(db, {
        actorAccountId: account.id,
        missionId,
        decision,
        decisionDate: new Date('2026-01-15T00:00:00Z'),
        stepUpSatisfied: true,
      });
      expect(isOk(result), decision).toBe(true);
    }
    const labels = (await outcomeEvents()).map((e) => e.dimension).sort();
    expect(labels).toEqual([...decisions].sort());
  });

  it('records nothing when the outcome itself is refused', async () => {
    const { account, missionId } = await seed(db);
    const result = await recordOutcome(db, {
      actorAccountId: account.id,
      missionId,
      decision: 'APPROVED',
      decisionDate: new Date('2026-01-15T00:00:00Z'),
      stepUpSatisfied: false,
    });
    expect(isErr(result)).toBe(true);
    expect(await outcomeEvents()).toEqual([]);
  });
});
