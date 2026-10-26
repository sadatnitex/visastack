import type { AccountId, ApplicantId, MissionId } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { authorize, grantCoversMission } from '@visastack/policy';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { toPolicyGrant } from '../sharing';
import {
  caseExclusionsTablePresent,
  loadCaseExclusions,
  loadInvitationCaseExclusions,
  withCaseExclusions,
} from './grant-scope';

/**
 * The SQL form and the policy form of "does this grant cover this case" must
 * never disagree. The matrix below covers every grant shape (case-scoped to
 * each case, all-cases with no, one or several exceptions, an exception
 * recorded on a different grant) against every case, and both forms must give
 * the same answer for every pair.
 */

const HEAVY_TIMEOUT_MS = 60_000;

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

const GRANT_SHAPES = [
  'allCases',
  'allButC2',
  'allButC1C2',
  'allButAll',
  'onlyC1',
  'onlyC2',
] as const;
type GrantShape = (typeof GRANT_SHAPES)[number];

interface Fixture {
  readonly applicantId: string;
  readonly ownerId: string;
  readonly missions: readonly string[];
  readonly grants: Readonly<Record<GrantShape, string>>;
}

async function seed(db: Db): Promise<Fixture> {
  const [owner] = await db
    .insert(schema.accounts)
    .values({ email: 'owner@example.test' })
    .returning();
  const [recipient] = await db
    .insert(schema.accounts)
    .values({ email: 'recipient@example.test' })
    .returning();
  if (!owner || !recipient) throw new Error('accounts');
  const [applicant] = await db
    .insert(schema.applicants)
    .values({ ownerAccountId: owner.id, displayName: 'Owner' })
    .returning();
  if (!applicant) throw new Error('applicant');
  const missions: string[] = [];
  for (const title of ['C1', 'C2', 'C3']) {
    const [mission] = await db
      .insert(schema.missions)
      .values({ applicantId: applicant.id, title })
      .returning();
    if (!mission) throw new Error('mission');
    missions.push(mission.id);
  }
  const [c1, c2, c3] = missions as [string, string, string];
  const shapes: Record<GrantShape, string | null> = {
    allCases: null,
    allButC2: null,
    allButC1C2: null,
    allButAll: null,
    onlyC1: c1,
    onlyC2: c2,
  };
  const grants: Partial<Record<GrantShape, string>> = {};
  for (const name of GRANT_SHAPES) {
    const missionId = shapes[name];
    const [grant] = await db
      .insert(schema.grants)
      .values({
        applicantId: applicant.id,
        recipientAccountId: recipient.id,
        missionId,
        actions: ['VIEW_METADATA'],
        purpose: name,
        // Active and accepted, so only case scope decides below.
        status: 'ACTIVE',
        startAt: new Date(Date.now() - 60_000),
        acceptedAt: new Date(Date.now() - 60_000),
      })
      .returning();
    if (!grant) throw new Error('grant');
    grants[name] = grant.id;
  }
  const exclusions: [GrantShape, string][] = [
    ['allButC2', c2],
    ['allButC1C2', c1],
    ['allButC1C2', c2],
    ['allButAll', c1],
    ['allButAll', c2],
    ['allButAll', c3],
  ];
  for (const [name, missionId] of exclusions) {
    await db.insert(schema.grantCaseExclusions).values({
      grantId: grants[name],
      missionId,
      applicantId: applicant.id,
      createdByAccountId: owner.id,
    });
  }
  const complete = GRANT_SHAPES.every((name) => grants[name] !== undefined);
  if (!complete) throw new Error('grants');
  return {
    applicantId: applicant.id,
    ownerId: owner.id,
    missions,
    grants: grants as Record<GrantShape, string>,
  };
}

/** Every (grant, case) pair the SQL rule says is covered, as "grantId:missionId". */
async function sqlCoveredPairs(db: Db, applicantId: string): Promise<Set<string>> {
  return withCaseExclusions(db, async (covers) => {
    const rows = await db
      .select({ grantId: schema.grants.id, missionId: schema.missions.id })
      .from(schema.grants)
      .innerJoin(schema.missions, eq(schema.missions.applicantId, schema.grants.applicantId))
      .where(and(eq(schema.grants.applicantId, applicantId), covers(schema.missions.id)));
    return new Set(rows.map((r) => `${r.grantId}:${r.missionId}`));
  });
}

/**
 * The same pairs according to the policy engine (`authorize`) and to its case
 * scope predicate (`grantCoversMission`, exported by packages/policy), fed from
 * the same rows through the production mapping (`toPolicyGrant`, the one every
 * access check uses), so a facet that mapping dropped would show here. The two
 * must agree on every pair. The rows are active and accepted, so only case
 * scope decides.
 */
async function policyCoveredPairs(db: Db, applicantId: string): Promise<Set<string>> {
  const grantRows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  const missionRows = await db
    .select({ id: schema.missions.id })
    .from(schema.missions)
    .where(eq(schema.missions.applicantId, applicantId));
  const exclusions = await loadCaseExclusions(db, { applicantId });
  const now = new Date();
  const pairs = new Set<string>();
  for (const grant of grantRows) {
    const recipient = (grant.recipientAccountId ?? '') as AccountId;
    const policyGrant = toPolicyGrant(grant, exclusions.get(grant.id));
    for (const mission of missionRows) {
      const decision = authorize({
        actor: { kind: 'individual_recipient', accountId: recipient },
        action: 'VIEW_METADATA',
        resource: { applicantId: applicantId as ApplicantId, missionId: mission.id as MissionId },
        context: { now, purpose: grant.purpose, stepUpSatisfied: false, grants: [policyGrant] },
      });
      // The predicate itself and the engine that uses it must give the same answer.
      expect(grantCoversMission(policyGrant, mission.id as MissionId)).toBe(decision.allowed);
      if (decision.allowed) pairs.add(`${grant.id}:${mission.id}`);
    }
  }
  return pairs;
}

describe('grant case scope: one rule in two forms', () => {
  it(
    'the SQL fragment and the policy predicate agree on every grant and case',
    async () => {
      const db = await freshDb();
      const f = await seed(db);
      const fromSql = await sqlCoveredPairs(db, f.applicantId);
      const fromPolicy = await policyCoveredPairs(db, f.applicantId);
      expect([...fromSql].sort()).toEqual([...fromPolicy].sort());

      // And both match the intended answers, so agreeing on a wrong rule cannot pass.
      const [c1, c2, c3] = f.missions as [string, string, string];
      const g = f.grants;
      const expected = [
        [g.allCases, c1],
        [g.allCases, c2],
        [g.allCases, c3],
        [g.allButC2, c1],
        [g.allButC2, c3],
        [g.allButC1C2, c3],
        [g.onlyC1, c1],
        [g.onlyC2, c2],
      ].map(([grantId, missionId]) => `${grantId}:${missionId}`);
      expect([...fromSql].sort()).toEqual(expected.sort());
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'an exception recorded for a case id that is a plain value works the same as a column',
    async () => {
      const db = await freshDb();
      const f = await seed(db);
      const [, c2] = f.missions as [string, string, string];
      const rows = await withCaseExclusions(db, (covers) =>
        db
          .select({ id: schema.grants.id })
          .from(schema.grants)
          .where(and(eq(schema.grants.applicantId, f.applicantId), covers(c2))),
      );
      expect(rows.map((r) => r.id).sort()).toEqual([f.grants.allCases, f.grants.onlyC2].sort());
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'loads exceptions per grant, by applicant or by grant ids, and keeps invitation rows apart',
    async () => {
      const db = await freshDb();
      const f = await seed(db);
      const byApplicant = await loadCaseExclusions(db, { applicantId: f.applicantId });
      expect(byApplicant.get(f.grants.allButC2)).toEqual([f.missions[1]]);
      expect(byApplicant.has(f.grants.allCases)).toBe(false);
      const byIds = await loadCaseExclusions(db, { grantIds: [f.grants.allButC1C2] });
      expect([...byIds.keys()]).toEqual([f.grants.allButC1C2]);
      expect(await loadCaseExclusions(db, { grantIds: [] })).toEqual(new Map());
      expect(await loadInvitationCaseExclusions(db, [])).toEqual(new Map());
    },
    HEAVY_TIMEOUT_MS,
  );
});

describe('grant case scope before migration 0090 has run', () => {
  it(
    'reads mean "no exceptions" and never break the surrounding transaction',
    async () => {
      const db = await freshDb();
      const f = await seed(db);
      await db.execute(sql`drop table grant_case_exclusions`);
      expect(await caseExclusionsTablePresent(db)).toBe(false);

      await db.transaction(async (tx) => {
        expect(await loadCaseExclusions(tx, { applicantId: f.applicantId })).toEqual(new Map());
        expect(await loadInvitationCaseExclusions(tx, [f.grants.allCases])).toEqual(new Map());
        const pairs = await sqlCoveredPairs(tx, f.applicantId);
        // Without the table every all-cases grant covers every case, exactly as before 0090.
        expect(pairs.size).toBe(4 * 3 + 2);
        // The transaction is still usable after the fallback.
        const after = await tx.select({ id: schema.applicants.id }).from(schema.applicants);
        expect(after).toHaveLength(1);
      });
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'any other failure of the table throws instead of reading as "no exceptions"',
    async () => {
      const db = await freshDb();
      const f = await seed(db);
      await db.execute(sql`alter table grant_case_exclusions rename column mission_id to gone`);
      await expect(loadCaseExclusions(db, { applicantId: f.applicantId })).rejects.toThrow();
      await expect(sqlCoveredPairs(db, f.applicantId)).rejects.toThrow();
    },
    HEAVY_TIMEOUT_MS,
  );
});

describe('grant case scope: the table presence check', () => {
  it(
    'remembers "present" per database handle, never "missing"',
    async () => {
      const client = await createMigratedPglite();
      let probes = 0;
      const db = drizzle(client, {
        schema,
        logger: {
          logQuery: (query: string) => {
            if (query.includes('to_regclass')) probes += 1;
          },
        },
      }) as unknown as Db;
      await db.execute(sql`alter table grant_case_exclusions rename to grant_case_exclusions_away`);
      expect(await caseExclusionsTablePresent(db)).toBe(false);
      expect(await caseExclusionsTablePresent(db)).toBe(false);
      expect(probes).toBe(2);
      await db.execute(sql`alter table grant_case_exclusions_away rename to grant_case_exclusions`);
      expect(await caseExclusionsTablePresent(db)).toBe(true);
      expect(await caseExclusionsTablePresent(db)).toBe(true);
      expect(
        await loadCaseExclusions(db, { grantIds: ['00000000-0000-4000-8000-000000000000'] }),
      ).toEqual(new Map());
      expect(probes).toBe(3);
      // Another handle on the same database asks for itself.
      const other = drizzle(client, { schema }) as unknown as Db;
      expect(await caseExclusionsTablePresent(other)).toBe(true);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'looks the table up through the search path, exactly as the queries do',
    async () => {
      const db = await freshDb();
      const f = await seed(db);
      await db.execute(sql`create schema relocated`);
      await db.execute(sql`alter table grant_case_exclusions set schema relocated`);
      await db.execute(sql`set search_path to relocated, public`);
      // The queries find the table through the search path, so the check must too.
      expect(await caseExclusionsTablePresent(db)).toBe(true);
      const byApplicant = await loadCaseExclusions(db, { applicantId: f.applicantId });
      expect(byApplicant.get(f.grants.allButC2)).toEqual([f.missions[1]]);
    },
    HEAVY_TIMEOUT_MS,
  );
});

describe('grant_case_exclusions table rules', () => {
  it(
    'refuses a row with both or neither parent, and duplicate exceptions',
    async () => {
      const db = await freshDb();
      const f = await seed(db);
      const [c1] = f.missions as [string];
      const base = { missionId: c1, applicantId: f.applicantId };
      await expect(db.insert(schema.grantCaseExclusions).values(base)).rejects.toThrow();
      await expect(
        db.insert(schema.grantCaseExclusions).values({ ...base, grantId: f.grants.allCases }),
      ).resolves.toBeDefined();
      await expect(
        db.insert(schema.grantCaseExclusions).values({ ...base, grantId: f.grants.allCases }),
      ).rejects.toThrow();
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'refuses a row that pairs one person with another person grant or case (composite keys)',
    async () => {
      const db = await freshDb();
      const f = await seed(db);
      const [other] = await db
        .insert(schema.applicants)
        .values({ ownerAccountId: f.ownerId, displayName: 'Other' })
        .returning();
      if (!other) throw new Error('other');
      const [otherMission] = await db
        .insert(schema.missions)
        .values({ applicantId: other.id, title: 'Other case' })
        .returning();
      if (!otherMission) throw new Error('other mission');
      // The grant belongs to the first person, the case to the second.
      await expect(
        db.insert(schema.grantCaseExclusions).values({
          grantId: f.grants.allCases,
          missionId: otherMission.id,
          applicantId: f.applicantId,
        }),
      ).rejects.toThrow();
      await expect(
        db.insert(schema.grantCaseExclusions).values({
          grantId: f.grants.allCases,
          missionId: otherMission.id,
          applicantId: other.id,
        }),
      ).rejects.toThrow();
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'removes exceptions with their grant or case',
    async () => {
      const db = await freshDb();
      const f = await seed(db);
      await db.delete(schema.grants).where(eq(schema.grants.id, f.grants.allButC1C2));
      await db.delete(schema.missions).where(eq(schema.missions.id, f.missions[2] ?? ''));
      const left = await db.select().from(schema.grantCaseExclusions);
      expect(left.map((r) => `${r.grantId}:${r.missionId}`).sort()).toEqual(
        [
          `${f.grants.allButC2}:${f.missions[1]}`,
          `${f.grants.allButAll}:${f.missions[0]}`,
          `${f.grants.allButAll}:${f.missions[1]}`,
        ].sort(),
      );
    },
    HEAVY_TIMEOUT_MS,
  );
});
