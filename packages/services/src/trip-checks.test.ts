import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal } from './access';
import { requireAccess } from './access/require-access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission } from './missions';
import { editFact, registerFieldDefinition } from './profile';
import { computeTripChecks } from './trip-checks';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function seed(db: Db) {
  const p = await provisionAccount(db, { email: 't@example.com' });
  if (!isOk(p)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: p.value.id,
    accountId: p.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: p.value.id,
    ownerAccountId: p.value.id,
    displayName: 'Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId: p.value.id, applicantId: applicant.value.id };
}

describe('computeTripChecks', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function newCase(
    seeded: { accountId: string; applicantId: string },
    dates: { start?: string; end?: string; deadline?: string },
  ) {
    const created = await createMission(db, {
      actorAccountId: seeded.accountId,
      applicantId: seeded.applicantId,
      title: 'Trip',
      manualMode: true,
      ...(dates.start ? { travelStartDate: new Date(`${dates.start}T00:00:00Z`) } : {}),
      ...(dates.end ? { travelEndDate: new Date(`${dates.end}T00:00:00Z`) } : {}),
      ...(dates.deadline ? { targetDeadline: new Date(`${dates.deadline}T00:00:00Z`) } : {}),
    });
    if (!isOk(created)) throw new Error('mission');
    const row = (
      await db.select().from(schema.missions).where(eq(schema.missions.id, created.value.id))
    )[0];
    if (!row) throw new Error('case row');
    return row;
  }

  async function saveFact(
    seeded: { accountId: string; applicantId: string },
    key: string,
    value: string,
    record?: string,
  ) {
    await registerFieldDefinition(db, {
      key,
      dataType: 'date',
      ...(record ? { repeating: true } : {}),
    });
    await editFact(db, {
      actorAccountId: seeded.accountId,
      applicantId: seeded.applicantId,
      fieldKey: key,
      value,
      ...(record ? { repeatingRecordKey: record } : {}),
    });
  }

  const now = new Date('2026-10-31T10:00:00Z');

  /** The checks as the case page asks for them: through the owner's access proof for the case. */
  async function run(seeded: { accountId: string }, missionId: string) {
    const gate = await requireAccess(
      db,
      accountPrincipal(seeded.accountId),
      'VIEW_METADATA',
      { missionId },
      { purpose: 'self' },
    );
    if (!isOk(gate)) throw new Error('gate');
    return computeTripChecks(gate.value, now);
  }

  it('reads the case dates and the profile passport expiry', async () => {
    const seeded = await seed(db);
    const mission = await newCase(seeded, { start: '2027-03-10', end: '2027-03-24' });
    await saveFact(seeded, 'passport_expiry', '2027-03-01');
    const result = await run(seeded, mission.id);
    const passport = result.find((check) => check.key === 'passport_validity');
    expect(passport?.level).toBe('problem');
  });

  it('asks for the expiry date when the profile has none, and gives nothing without trip dates', async () => {
    const seeded = await seed(db);
    const withDates = await newCase(seeded, { start: '2027-03-10', end: '2027-03-24' });
    const noDates = await newCase(seeded, {});
    const a = await run(seeded, withDates.id);
    const b = await run(seeded, noDates.id);
    expect(a.map((check) => check.level)).toEqual(['unknown']);
    expect(b).toEqual([]);
  });

  it('pairs the two dates of one insurance record, so one policy must cover the whole trip', async () => {
    const seeded = await seed(db);
    const mission = await newCase(seeded, { start: '2027-03-10', end: '2027-03-24' });
    await saveFact(seeded, 'passport_expiry', '2030-01-01');
    await saveFact(seeded, 'travel_insurance_valid_from', '2027-03-10', 'p1');
    await saveFact(seeded, 'travel_insurance_valid_until', '2027-03-17', 'p1');
    await saveFact(seeded, 'travel_insurance_valid_from', '2027-03-18', 'p2');
    await saveFact(seeded, 'travel_insurance_valid_until', '2027-03-24', 'p2');
    const split = await run(seeded, mission.id);
    expect(split.find((check) => check.key === 'insurance_cover')?.level).toBe('check');

    await saveFact(seeded, 'travel_insurance_valid_until', '2027-03-25', 'p1');
    const covered = await run(seeded, mission.id);
    expect(covered.find((check) => check.key === 'insurance_cover')?.level).toBe('ok');
  });

  it('gives nothing once the case is handed in, closed or cancelled', async () => {
    const seeded = await seed(db);
    const mission = await newCase(seeded, { start: '2027-03-10', end: '2027-03-24' });
    await saveFact(seeded, 'passport_expiry', '2027-03-01');
    expect(await run(seeded, mission.id)).not.toEqual([]);
    for (const state of ['SUBMITTED', 'CLOSED', 'CANCELLED'] as const) {
      await db.update(schema.missions).set({ state }).where(eq(schema.missions.id, mission.id));
      expect(await run(seeded, mission.id)).toEqual([]);
    }
  });

  it('uses the latest passport expiry and reads a malformed or impossible date as not recorded', async () => {
    const seeded = await seed(db);
    const mission = await newCase(seeded, { start: '2027-03-10', end: '2027-03-24' });
    await saveFact(seeded, 'passport_expiry', '2027-02-31');
    const impossible = await run(seeded, mission.id);
    expect(impossible.find((check) => check.key === 'passport_validity')?.level).toBe('unknown');
    await saveFact(seeded, 'passport_expiry', '2027-03-10abc');
    const malformed = await run(seeded, mission.id);
    expect(malformed.find((check) => check.key === 'passport_validity')?.level).toBe('unknown');
    await saveFact(seeded, 'passport_expiry', '2031-05-05');
    const fine = await run(seeded, mission.id);
    expect(fine.find((check) => check.key === 'passport_validity')?.level).toBe('ok');
  });
});
