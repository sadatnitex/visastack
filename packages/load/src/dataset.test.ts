import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  listApplicantProfile,
  listApplicants,
  listApplicantsForOrganization,
  listDocumentsDetailed,
  listNotificationsForAccount,
  listVisibleMissionsForMember,
} from '@visastack/services';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { type DatasetManifest, TINY_SHAPE, makeRandom, seedDataset, skewedCounts } from './dataset';
import { rowsOf } from './rows';

describe('dataset generator (tiny shape, in-memory database)', () => {
  let db: Db;
  let manifest: DatasetManifest;

  beforeAll(async () => {
    const client = await createMigratedPglite();
    const handle = drizzle(client, { schema });
    db = handle as unknown as Db;
    manifest = await seedDataset(db, TINY_SHAPE);
  }, 120_000);

  it('creates exactly the requested numbers of agencies, staff, travellers and cases', async () => {
    const count = async (table: string) => {
      const r = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
      return rowsOf<{ n: number }>(r)[0]?.n ?? -1;
    };
    expect(await count('organizations')).toBe(TINY_SHAPE.agencies + 1);
    expect(await count('memberships')).toBe((TINY_SHAPE.agencies + 1) * TINY_SHAPE.staffPerAgency);
    expect(await count('applicants')).toBe(TINY_SHAPE.travellers);
    expect(await count('missions')).toBe(TINY_SHAPE.cases);
    expect(Object.keys(manifest.counts)).toContain('notifications');
  });

  it('is repeatable: the same seed gives the same shape', () => {
    const a = makeRandom(7);
    const b = makeRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(skewedCounts(20, 1000).reduce((x, y) => x + y, 0)).toBe(1000);
    expect(skewedCounts(20, 1000)[0]).toBeGreaterThan(skewedCounts(20, 1000)[19] as number);
  });

  it('feeds the real list functions: an agency admin sees its cases, the stress agency sees them all', async () => {
    const agency = manifest.agencies[0];
    const admin = agency?.staff.find((s) => s.role === 'ADMIN');
    expect(agency && admin).toBeTruthy();
    const own = await listVisibleMissionsForMember(
      db,
      agency?.organizationId as string,
      admin?.accountId as string,
    );
    expect(own.admin).toBe(true);
    expect(own.missions.length).toBeGreaterThanOrEqual(agency?.caseCount ?? 0);
    const stress = manifest.stressAgency;
    const everything = await listVisibleMissionsForMember(
      db,
      stress?.organizationId as string,
      stress?.staff[1]?.accountId as string,
    );
    expect(everything.missions.length).toBe(TINY_SHAPE.cases);
    const people = await listApplicantsForOrganization(db, stress?.organizationId as string);
    expect(people.length).toBe(TINY_SHAPE.cases);
  });

  it('feeds the traveller screens', async () => {
    const t = manifest.travellers[0];
    expect((await listApplicants(db, t?.accountId as string)).length).toBe(1);
    const docs = await listDocumentsDetailed(db, t?.accountId as string, t?.applicantId as string);
    expect(isOk(docs) && docs.value.length >= 1).toBe(true);
    expect((await listApplicantProfile(db, t?.applicantId as string)).length).toBe(
      TINY_SHAPE.factsPerTraveller,
    );
    expect((await listNotificationsForAccount(db, t?.accountId as string)).length).toBe(
      TINY_SHAPE.notificationsPerTraveller,
    );
  });
});
