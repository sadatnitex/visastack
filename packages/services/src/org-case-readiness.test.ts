import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { assignMember } from './agency';
import type { Db } from './db';
import {
  type Agency,
  type Traveller,
  cleanDocument,
  share,
  traveller,
} from './evidence-submissions.test-support';
import { setState, twoCases } from './finished-case-freeze.test-support';
import {
  type Mission,
  attachPackVersion,
  computeReadiness,
  computeReadinessMany,
  createMission,
} from './missions';
import { listCaseReadinessForOrg } from './org-case-readiness';
import { addMembership } from './organizations';
import {
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { type TrustWorld, trustWorld } from './trust-rules/trust-rules.test-support';

/**
 * WP-PIC18: the readiness of each case on the agency's Cases list. Only the cases the acting member
 * may read through a live grant are answered (the same rule as `listAccessEndsForOrg`), the number
 * of queries does not grow with the page, and each answer is exactly the case page's reading.
 */

type Row = Omit<RequirementInput, 'citation'>;

async function publishedPack(db: Db, actor: string, rows: readonly Row[]): Promise<string> {
  const pack = await createPack(db, {
    actorAccountId: actor,
    key: `pic18.${Math.random().toString(36).slice(2)}`,
    name: 'PIC18 Synthetic',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  for (const row of rows) {
    const added = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      citation: 'Synthetic rule',
      ...row,
    });
    if (!isOk(added)) throw new Error(`requirement: ${added.error.message}`);
  }
  const approved = await approvePackVersion(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
  });
  if (!isOk(approved)) throw new Error(`approve: ${approved.error.message}`);
  const published = await publishPackVersion(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
  });
  if (!isOk(published)) throw new Error(`publish: ${published.error.message}`);
  return version.value.id;
}

/** Passport answer, passport, a funds group of two alternatives, a recent photo, an optional hotel. */
const PACK_A: readonly Row[] = [
  { kind: 'FIELD', fieldKey: 'passport.number' },
  { kind: 'DOCUMENT', docType: 'passport' },
  { kind: 'DOCUMENT', docType: 'bank_statement', groupKey: 'funds', groupMode: 'ANY_OF' },
  { kind: 'DOCUMENT', docType: 'sponsor_letter', groupKey: 'funds', groupMode: 'ANY_OF' },
  { kind: 'DOCUMENT', docType: 'photo', maxAgeDays: 30 },
  { kind: 'DOCUMENT', docType: 'hotel_booking', optional: true },
];

const PACK_B: readonly Row[] = [
  { kind: 'FIELD', fieldKey: 'employer.name' },
  { kind: 'DOCUMENT', docType: 'insurance' },
  { kind: 'DOCUMENT', docType: 'bank_statement' },
];

async function caseOn(db: Db, t: Traveller, packVersionId: string | null, title = 'Case') {
  const mission = await createMission(db, {
    actorAccountId: t.accountId,
    applicantId: t.applicantId,
    title,
  });
  if (!isOk(mission)) throw new Error('mission');
  if (packVersionId) {
    const attached = await attachPackVersion(db, {
      actorAccountId: t.accountId,
      missionId: mission.value.id,
      packVersionId,
    });
    if (!isOk(attached)) throw new Error(`attach: ${attached.error.message}`);
  }
  return mission.value.id;
}

async function answer(db: Db, t: Traveller, key: string, value: string) {
  await registerFieldDefinition(db, { key, dataType: 'string' });
  const edited = await editFact(db, {
    actorAccountId: t.accountId,
    applicantId: t.applicantId,
    fieldKey: key,
    value,
  });
  if (!isOk(edited)) throw new Error(`fact ${key}`);
  return edited.value;
}

async function missionRows(db: Db, ids: readonly string[]): Promise<Mission[]> {
  return db
    .select()
    .from(schema.missions)
    .where(inArray(schema.missions.id, [...ids]));
}

/** What the list keeps of one case page reading. */
async function caseReadingOf(db: Db, missionId: string) {
  const reading = await computeReadiness(db, missionId);
  if (!isOk(reading)) throw new Error('readiness');
  const { requiredCount, satisfiedRequired, missing } = reading.value;
  return {
    requiredCount,
    satisfiedRequired,
    missing: missing.map((m) => ({
      kind: m.kind,
      optional: m.optional,
      reason: m.reason,
      ...(m.alternatives ? { alternatives: m.alternatives.map((a) => ({ kind: a.kind })) } : {}),
    })),
  };
}

interface Small extends TrustWorld {
  readonly packA: string;
  readonly caseA: string;
}

async function smallWorld(): Promise<Small> {
  const w = await trustWorld();
  const packA = await publishedPack(w.db, w.rahim.accountId, PACK_A);
  const caseA = await caseOn(w.db, w.rahim, packA, 'Case A');
  await answer(w.db, w.rahim, 'passport.number', 'A1234567');
  return { ...w, packA, caseA };
}

async function reviewerOf(db: Db, a: Agency): Promise<string> {
  const account = await traveller(db, `pic18-reviewer-${randomUUID()}@example.test`);
  const added = await addMembership(db, {
    actorAccountId: a.accountId,
    organizationId: a.organizationId,
    accountId: account.accountId,
    role: 'REVIEWER',
  });
  if (!isOk(added)) throw new Error(`reviewer: ${added.error.message}`);
  return account.accountId;
}

describe('listCaseReadinessForOrg: who may read', () => {
  it('an unassigned member who is not an admin gets nothing; an admin and an assigned member get the case', async () => {
    const w = await smallWorld();
    const org = w.north.organizationId;
    const reviewer = await reviewerOf(w.db, w.north);
    expect((await listCaseReadinessForOrg(w.db, reviewer, org, [w.caseA])).size).toBe(0);
    const asAdmin = await listCaseReadinessForOrg(w.db, w.north.accountId, org, [w.caseA]);
    expect(asAdmin.get(w.caseA)).toEqual(await caseReadingOf(w.db, w.caseA));
    const assigned = await assignMember(w.db, {
      actorAccountId: w.north.accountId,
      organizationId: org,
      memberAccountId: reviewer,
      missionId: w.caseA,
    });
    expect(isOk(assigned)).toBe(true);
    expect((await listCaseReadinessForOrg(w.db, reviewer, org, [w.caseA])).has(w.caseA)).toBe(true);
  });

  it('an expired grant, a revoked grant and a per-case exception reach nothing', async () => {
    const w = await smallWorld();
    const ask = () =>
      listCaseReadinessForOrg(w.db, w.north.accountId, w.north.organizationId, [w.caseA]);
    expect((await ask()).has(w.caseA)).toBe(true);

    const day = 24 * 60 * 60 * 1000;
    await w.db
      .update(schema.grants)
      .set({ startAt: new Date(Date.now() - 2 * day), expiryAt: new Date(Date.now() - day) })
      .where(eq(schema.grants.id, w.northGrantId));
    expect((await ask()).size).toBe(0);
    await w.db
      .update(schema.grants)
      .set({ expiryAt: null })
      .where(eq(schema.grants.id, w.northGrantId));
    expect((await ask()).has(w.caseA)).toBe(true);

    await w.db.insert(schema.grantCaseExclusions).values({
      grantId: w.northGrantId,
      missionId: w.caseA,
      applicantId: w.rahim.applicantId,
      createdByAccountId: w.rahim.accountId,
    });
    expect((await ask()).size).toBe(0);
    await w.db
      .delete(schema.grantCaseExclusions)
      .where(eq(schema.grantCaseExclusions.missionId, w.caseA));
    expect((await ask()).has(w.caseA)).toBe(true);

    await w.db
      .update(schema.grants)
      .set({ status: 'REVOKED' })
      .where(eq(schema.grants.id, w.northGrantId));
    expect((await ask()).size).toBe(0);
  });

  it("another organization's case, a made-up case, a made-up organization and a stranger get nothing", async () => {
    const w = await smallWorld();
    const karimCase = await caseOn(w.db, w.karim, w.packA, 'Karim case');
    await share(w.db, w.karim, w.unrelated);
    const org = w.north.organizationId;
    const asked = [w.caseA, karimCase, randomUUID(), 'not-a-uuid'];
    const answer = await listCaseReadinessForOrg(w.db, w.north.accountId, org, asked);
    expect([...answer.keys()]).toEqual([w.caseA]);
    expect(
      (await listCaseReadinessForOrg(w.db, w.north.accountId, randomUUID(), [w.caseA])).size,
    ).toBe(0);
    expect((await listCaseReadinessForOrg(w.db, w.unrelated.accountId, org, [w.caseA])).size).toBe(
      0,
    );
    expect((await listCaseReadinessForOrg(w.db, w.rahim.accountId, org, [w.caseA])).size).toBe(0);
    expect((await listCaseReadinessForOrg(w.db, w.north.accountId, org, [])).size).toBe(0);
  });

  it('a case in manual mode and a case with no checklist get no entry', async () => {
    const w = await smallWorld();
    const bare = await caseOn(w.db, w.rahim, null, 'No checklist');
    const manual = await caseOn(w.db, w.rahim, w.packA, 'Manual');
    await w.db
      .update(schema.missions)
      .set({ manualMode: true })
      .where(eq(schema.missions.id, manual));
    const answer = await listCaseReadinessForOrg(w.db, w.north.accountId, w.north.organizationId, [
      w.caseA,
      bare,
      manual,
    ]);
    expect([...answer.keys()]).toEqual([w.caseA]);
  });

  it('never returns a key, label or value from the records', async () => {
    const w = await smallWorld();
    const answer = await listCaseReadinessForOrg(w.db, w.north.accountId, w.north.organizationId, [
      w.caseA,
    ]);
    const text = JSON.stringify([...answer.values()]);
    expect(text).not.toMatch(/passport|bank_statement|sponsor|photo|hotel|A1234567|key/);
  });
});

describe('listCaseReadinessForOrg: one fixed set of queries', () => {
  it('reads one case and fifteen cases (fifteen travellers, two checklists) in the same number of queries', async () => {
    const w = await trustWorld();
    const packA = await publishedPack(w.db, w.rahim.accountId, PACK_A);
    const packB = await publishedPack(w.db, w.rahim.accountId, PACK_B);
    const ids: string[] = [];
    for (let i = 0; i < 15; i++) {
      const t = await traveller(w.db, `pic18-load-${i}@example.test`);
      await share(w.db, t, w.north);
      await answer(w.db, t, 'passport.number', `P${i}`);
      await cleanDocument(w.db, t, i % 2 === 0 ? 'passport' : 'insurance');
      ids.push(await caseOn(w.db, t, i % 2 === 0 ? packA : packB, `Load ${i}`));
    }
    const queries: string[] = [];
    const client = (w.db as unknown as { $client: PGlite }).$client;
    const logged = drizzle(client, {
      schema,
      logger: { logQuery: (query: string) => queries.push(query) },
    }) as unknown as Db;
    const run = async (asked: readonly string[]) => {
      queries.length = 0;
      const answer = await listCaseReadinessForOrg(
        logged,
        w.north.accountId,
        w.north.organizationId,
        asked,
      );
      return { size: answer.size, count: queries.length };
    };
    await run(ids); // Warms the per-handle "is this table here" answers.
    const one = await run(ids.slice(0, 1));
    const fifteen = await run(ids);
    expect(one.size).toBe(1);
    expect(fifteen.size).toBe(15);
    expect(fifteen.count).toBe(one.count);
  });
});

describe('computeReadinessMany: exactly the case page reading', () => {
  it('equals computeReadiness for open, finished, grouped, stale, conflicted and archived cases', async () => {
    const w = await smallWorld();
    const { db, rahim } = w;
    // Conflicted answer: the passport number is in conflict.
    const fact = await answer(db, rahim, 'passport.number', 'B7654321');
    const [current] = await db
      .select({ versionId: schema.facts.currentVersionId })
      .from(schema.facts)
      .where(eq(schema.facts.id, fact.fact.id));
    if (!current?.versionId) throw new Error('fact version');
    await db
      .update(schema.factVersions)
      .set({ status: 'CONFLICTED' })
      .where(eq(schema.factVersions.id, current.versionId));
    // Archived passport, a bank statement for the funds group, an old photo.
    const passport = await cleanDocument(db, rahim, 'passport', 'passport.pdf');
    await db.insert(schema.documentLifecycle).values({
      documentId: passport.documentId,
      applicantId: rahim.applicantId,
      archivedAt: new Date(),
      archivedByAccountId: rahim.accountId,
    });
    await cleanDocument(db, rahim, 'bank_statement', 'statement.pdf', 'b'.repeat(64));
    const photo = await cleanDocument(db, rahim, 'photo', 'photo.jpg', 'c'.repeat(64));
    await db
      .update(schema.documents)
      .set({ documentDate: '2000-01-01' })
      .where(eq(schema.documents.id, photo.documentId));

    const closedWithout = await caseOn(db, rahim, w.packA, 'Closed, no copy');
    await setState(db, closedWithout, 'CLOSED', new Date());
    const bare = await caseOn(db, rahim, null, 'No checklist');
    const finished = await twoCases(db, 'FIELD');
    const closedWithCopy = finished.openId;
    await setState(db, closedWithCopy, 'CLOSED', new Date());

    const ids = [w.caseA, closedWithout, bare, finished.finishedId, closedWithCopy];
    const many = await computeReadinessMany(db, await missionRows(db, ids));
    expect([...many.keys()].sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(many.get(id), id).toEqual(await computeReadiness(db, id));
    }

    // The fixture really reaches the states it names.
    const open = many.get(w.caseA);
    if (!open?.ok) throw new Error('open case');
    const reasons = open.value.missing.map((m) => m.reason);
    expect(reasons).toContain('unresolved_conflict');
    expect(reasons).toContain('stale_evidence');
    expect(open.value.missing.some((m) => m.alternatives !== undefined)).toBe(false);
    const submitted = many.get(finished.finishedId);
    const withCopy = many.get(closedWithCopy);
    const withoutCopy = many.get(closedWithout);
    expect(submitted?.ok && submitted.value.savedCopy).toBe('AS_FINISHED');
    expect(withCopy?.ok && withCopy.value.savedCopy).toBe('AS_FINISHED');
    expect(withoutCopy?.ok && withoutCopy.value.savedCopy).toBe('NONE');
    expect(many.get(bare)?.ok).toBe(false);

    // The list keeps exactly the case page's counts and missing kinds.
    const listed = await listCaseReadinessForOrg(db, w.north.accountId, w.north.organizationId, [
      w.caseA,
      closedWithout,
    ]);
    expect(listed.get(w.caseA)).toEqual(await caseReadingOf(db, w.caseA));
    expect(listed.get(closedWithout)).toEqual(await caseReadingOf(db, closedWithout));
  });

  it('a funds group nobody covered is one missing entry with its alternatives', async () => {
    const w = await smallWorld();
    const many = await computeReadinessMany(w.db, await missionRows(w.db, [w.caseA]));
    expect(many.get(w.caseA)).toEqual(await computeReadiness(w.db, w.caseA));
    const reading = many.get(w.caseA);
    if (!reading?.ok) throw new Error('reading');
    const group = reading.value.missing.filter((m) => m.alternatives !== undefined);
    expect(group).toHaveLength(1);
    expect(group[0]?.alternatives?.map((a) => a.kind)).toEqual(['DOCUMENT', 'DOCUMENT']);
  });
});
