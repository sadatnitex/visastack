/**
 * UMPE G2 (R02, R05, R08, S08, R12, R18, R22), synthetic data only. Pins:
 * 1. Route conditions: a pack that declares nothing matches exactly as before; a known application
 *    post or trip start outside what a pack declares leaves it out; a missing case value is asked
 *    for (never guessed) and the pack is never linked on its own; before the tables exist nothing
 *    changes.
 * 2. Rule details: saved only on a draft, format rules only on documents, audited with counts.
 * 3. Field observations: never Mandatory, never stored without a non-blocking necessity.
 * 4. The source check date: the last read that reached the page, never a blocked fetch.
 * 5. The case-aware expiry check: one entry per chosen document that will not last the trip, the
 *    checklist's months after travel respected, active cases only, unknown travel end never guessed.
 * 6. Past applications: saved on the profile and never read by matching.
 */
import { readFileSync } from 'node:fs';
import { isErr, isOk } from '@visastack/core';
import { CATALOGUE_FIELDS } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  attachPackVersion,
  createMission,
  snapshotMission,
  updateMissionCaseDetails,
} from './missions';
import { caseExpiryConflicts } from './notification-sweep';
import {
  type TravellerMatchTerms,
  findMatchingPublicPack,
  listFittingPublicPacks,
  readTravellerCoverage,
} from './pack-matching';
import {
  listPackRouteConditions,
  listRequirementDetails,
  setPackRouteConditions,
  setRequirementDetails,
} from './pack-rule-details';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  buildManifest,
  createPack,
  diffPackVersions,
  listRequirements,
  publishPackVersion,
  verifyPackChecksum,
} from './packs';
import { grantPlatformRole } from './platform-roles';
import { editFact, registerFieldDefinition } from './profile';
import type { RuleCondition } from './rule-conditions';
import { latestSourceChecks } from './source-monitor';
import { getCasePackage } from './umpe-package-service';
import { assessRuleImpact } from './umpe-rule-impact-service';

const TEST_TIMEOUT_MS = 60_000;
const NONE = { terms: [], known: false };
const UNKNOWN: TravellerMatchTerms = { nationality: NONE, residence: NONE };
const ukTrip = {
  country: ['GB', 'United Kingdom', 'UK'],
  purpose: ['Tourism'],
  traveller: UNKNOWN,
};

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

const NO_DETAILS = {
  category: null,
  acceptedForm: null,
  translationNeeded: null,
  originalNeeded: null,
  statementPeriodMonths: null,
  validMonthsAfterTravel: null,
  effectiveSince: null,
} as const;

const OWNER_EMAIL = 'g2-owner@example.com';

async function seed(db: Db) {
  const account = await provisionAccount(db, { email: OWNER_EMAIL });
  if (!isOk(account)) throw new Error('provision');
  // Synthetic platform owner, so the same account may manage packs (a fresh staff scope per call).
  const granted = await grantPlatformRole(db, {
    actor: { accountId: account.value.id, email: OWNER_EMAIL, bootstrapEmails: [OWNER_EMAIL] },
    targetAccountId: account.value.id,
    role: 'PLATFORM_OWNER',
    reason: 'synthetic seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  await setConsent(db, {
    actorAccountId: account.value.id,
    accountId: account.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.value.id,
    ownerAccountId: account.value.id,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { actor: account.value.id, applicantId: applicant.value.id };
}

/** A published authoritative UK tourism pack, with one requirement per given doc type. */
async function publicPack(
  db: Db,
  actor: string,
  name: string,
  docTypes: readonly string[] = ['PASSPORT'],
) {
  const pack = await createPack(db, {
    actorAccountId: actor,
    key: `g2.${name.toLowerCase().replace(/\W+/g, '.')}`,
    name,
    jurisdiction: 'UK',
    purpose: 'Tourism',
  });
  if (!isOk(pack)) throw new Error(`pack: ${pack.error.message}`);
  // Matching reads only authoritative public packs; set it directly so one account can publish.
  await db
    .update(schema.packs)
    .set({ authoritative: true })
    .where(eq(schema.packs.id, pack.value.id));
  const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  const requirementIds: string[] = [];
  for (const docType of docTypes) {
    const added = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType,
      citation: 'Synthetic rule',
    });
    if (!isOk(added)) throw new Error(`requirement: ${added.error.message}`);
    requirementIds.push(added.value.id);
  }
  return { packId: pack.value.id, versionId: version.value.id, requirementIds };
}

async function publish(db: Db, actor: string, versionId: string) {
  await db
    .update(schema.packs)
    .set({ authoritative: false })
    .where(eq(schema.packs.id, sql`(select pack_id from pack_versions where id = ${versionId})`));
  const approved = await approvePackVersion(db, {
    actorAccountId: actor,
    packVersionId: versionId,
  });
  if (!isOk(approved)) throw new Error(`approve: ${approved.error.message}`);
  const published = await publishPackVersion(db, {
    actorAccountId: actor,
    packVersionId: versionId,
  });
  if (!isOk(published)) throw new Error(`publish: ${published.error.message}`);
  await db
    .update(schema.packs)
    .set({ authoritative: true })
    .where(eq(schema.packs.id, sql`(select pack_id from pack_versions where id = ${versionId})`));
}

async function staff(db: Db, accountId: string) {
  const minted = await staffPrincipal(
    db,
    { accountId, email: OWNER_EMAIL, bootstrapEmails: [] },
    'PACK_MANAGE',
  );
  if (!isOk(minted)) throw new Error('scope');
  return minted.value;
}

describe('route conditions in matching (R05)', () => {
  let db: Db;
  let actor: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = (await seed(db)).actor;
  });

  it(
    'matches a pack that declares nothing exactly as before, whatever the case holds',
    async () => {
      const plain = await publicPack(db, actor, 'Plain');
      await publish(db, actor, plain.versionId);
      const expected = {
        packVersionId: plain.versionId,
        packName: 'Plain',
        version: 1,
        coversTraveller: true,
        coversRoute: true,
      };
      expect(await findMatchingPublicPack(db, ukTrip)).toEqual(expected);
      expect(
        await findMatchingPublicPack(db, {
          ...ukTrip,
          consularPost: 'British High Commission Dhaka',
          travelStart: new Date('2027-01-10T00:00:00Z'),
        }),
      ).toEqual(expected);
    },
    TEST_TIMEOUT_MS,
  );

  /** A published public pack whose version declares these route conditions (set while a draft). */
  async function packWith(
    name: string,
    conditions: { consularPosts?: string[]; travelFrom?: string; travelUntil?: string },
  ) {
    const p = await publicPack(db, actor, name);
    const saved = await setPackRouteConditions(db, await staff(db, actor), {
      packVersionId: p.versionId,
      consularPosts: conditions.consularPosts ?? [],
      travelFrom: conditions.travelFrom ?? null,
      travelUntil: conditions.travelUntil ?? null,
    });
    if (!isOk(saved)) throw new Error(`conditions: ${saved.error.message}`);
    await publish(db, actor, p.versionId);
    return { ...p, saved: saved.value };
  }

  it(
    'leaves out a pack for another application post, and links one whose post the case names',
    async () => {
      const dhaka = await packWith('Dhaka Only', { consularPosts: ['Dhaka', ' dhaka ', ''] });
      expect(dhaka.saved.consularPosts).toEqual(['Dhaka']);
      const elsewhere = { ...ukTrip, consularPost: 'British Embassy Chattogram' };
      expect(await listFittingPublicPacks(db, elsewhere)).toEqual([]);
      // Either way round: a case that says only "Dhaka" fits a pack naming the full post.
      const fullName = await packWith('Full Post Name', {
        consularPosts: ['British High Commission Dhaka'],
      });
      expect(
        (await listFittingPublicPacks(db, { ...ukTrip, consularPost: 'Dhaka' })).map(
          (m) => m.packName,
        ),
      ).toEqual(['Dhaka Only', 'Full Post Name']);
      await db.delete(schema.packs).where(eq(schema.packs.id, fullName.packId));
      // A post with no letters VisaStack can compare is refused rather than saved unmatchable.
      const draft = await publicPack(db, actor, 'Unmatchable Post');
      const unmatchable = await setPackRouteConditions(db, await staff(db, actor), {
        packVersionId: draft.versionId,
        consularPosts: [String.fromCodePoint(0x09a2, 0x09be, 0x0995, 0x09be)],
        travelFrom: null,
        travelUntil: null,
      });
      expect(isErr(unmatchable)).toBe(true);
      // Whole words only: "Dhakar" is not "Dhaka".
      expect(
        await listFittingPublicPacks(db, { ...ukTrip, consularPost: 'Dhakar Office' }),
      ).toEqual([]);
      const named = await findMatchingPublicPack(db, {
        ...ukTrip,
        consularPost: 'VFS Global, Dhaka',
      });
      expect(named?.packVersionId).toBe(dhaka.versionId);
      expect(named?.needs).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'asks for a missing post or travel date and never links the pack on its own',
    async () => {
      const both = await packWith('Window And Post', {
        consularPosts: ['Dhaka'],
        travelFrom: '2027-01-01',
        travelUntil: '2027-12-31',
      });
      const listed = await listFittingPublicPacks(db, ukTrip);
      expect(listed.map((p) => p.needs)).toEqual([['APPLICATION_POST', 'TRAVEL_DATES']]);
      expect(await findMatchingPublicPack(db, ukTrip)).toBeNull();
      const postOnly = { ...ukTrip, consularPost: 'Dhaka' };
      expect((await listFittingPublicPacks(db, postOnly))[0]?.needs).toEqual(['TRAVEL_DATES']);
      expect(await findMatchingPublicPack(db, postOnly)).toBeNull();
      // Outside the window: left out. Inside: linked.
      expect(
        await listFittingPublicPacks(db, { ...postOnly, travelStart: new Date('2028-02-01') }),
      ).toEqual([]);
      expect(
        (await findMatchingPublicPack(db, { ...postOnly, travelStart: new Date('2027-06-01') }))
          ?.packVersionId,
      ).toBe(both.versionId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'changes route conditions only on a draft, carries them into the next draft, and audits counts',
    async () => {
      const p = await publicPack(db, actor, 'Versioned Conditions');
      const bad = await setPackRouteConditions(db, await staff(db, actor), {
        packVersionId: p.versionId,
        consularPosts: [],
        travelFrom: '2027-05-01',
        travelUntil: '2027-04-01',
      });
      expect(isErr(bad)).toBe(true);
      // A forged scope is refused like any other pack change without the role.
      const forged = await setPackRouteConditions(
        db,
        { accountId: actor, platformAction: 'PACK_MANAGE', verifiedAt: new Date() } as never,
        {
          packVersionId: p.versionId,
          consularPosts: ['Dhaka'],
          travelFrom: null,
          travelUntil: null,
        },
      );
      expect(isErr(forged) && forged.error.code).toBe('forbidden');
      await setPackRouteConditions(db, await staff(db, actor), {
        packVersionId: p.versionId,
        consularPosts: [],
        travelFrom: null,
        travelUntil: null,
      });
      expect((await listPackRouteConditions(db, [p.versionId])).size).toBe(0);
      await setPackRouteConditions(db, await staff(db, actor), {
        packVersionId: p.versionId,
        consularPosts: ['Dhaka'],
        travelFrom: null,
        travelUntil: null,
      });
      await publish(db, actor, p.versionId);
      // Published: fixed. Who it is for changes only through a new reviewed version.
      const onPublished = await setPackRouteConditions(db, await staff(db, actor), {
        packVersionId: p.versionId,
        consularPosts: ['Sylhet'],
        travelFrom: null,
        travelUntil: null,
      });
      expect(isErr(onPublished)).toBe(true);
      expect((await listPackRouteConditions(db, [p.versionId])).get(p.versionId)).toMatchObject({
        consularPosts: ['Dhaka'],
      });
      const next = await addPackVersion(db, { actorAccountId: actor, packId: p.packId });
      if (!isOk(next)) throw new Error('next');
      expect((await listPackRouteConditions(db, [next.value.id])).get(next.value.id)).toMatchObject(
        { consularPosts: ['Dhaka'] },
      );
      const audits = await db
        .select({ metadata: schema.auditEvents.metadata })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'PACK_ROUTE_CONDITIONS_SET'));
      expect(audits).toHaveLength(2);
      expect(JSON.stringify(audits)).not.toContain('Dhaka');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'changes nothing before the G2 tables exist',
    async () => {
      const p = await publicPack(db, actor, 'Before Migration');
      await publish(db, actor, p.versionId);
      await db.execute(sql`drop table pack_route_conditions`);
      await db.execute(sql`drop table pack_requirement_details`);
      // A new handle over the same database: no remembered "tables present" answer.
      const fresh = drizzle((db as unknown as { $client: never }).$client, {
        schema,
      }) as unknown as Db;
      expect(
        (await findMatchingPublicPack(fresh, { ...ukTrip, consularPost: 'Anywhere' }))
          ?.packVersionId,
      ).toBe(p.versionId);
      expect(await verifyPackChecksum(fresh, p.versionId)).toBe(true);
      expect(
        (await listRequirementDetails(fresh, ['00000000-0000-4000-8000-000000000000'])).size,
      ).toBe(0);
      const draft = await publicPack(fresh, actor, 'Draft Before Migration');
      const refused = await setPackRouteConditions(fresh, await staff(fresh, actor), {
        packVersionId: draft.versionId,
        consularPosts: ['Dhaka'],
        travelFrom: null,
        travelUntil: null,
      });
      expect(isErr(refused)).toBe(true);
      // A field observation waits for the same migration instead of failing in the database.
      const observed = await addRequirement(fresh, {
        actorAccountId: actor,
        packVersionId: draft.versionId,
        kind: 'DOCUMENT',
        docType: 'COVER_LETTER',
        citation: 'Seen in synthetic cases',
        necessity: 'RECOMMENDED',
        provenance: 'FIELD_OBSERVATION',
      });
      expect(isErr(observed) && observed.error.message).toContain('waiting for a database update');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('rule details and field observations (R02, R12, S08)', () => {
  let db: Db;
  let actor: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = (await seed(db)).actor;
  });

  it(
    'saves details on a draft only, format rules on documents only, audited with counts',
    async () => {
      const p = await publicPack(db, actor, 'Details', ['BANK_STATEMENT']);
      const requirementId = p.requirementIds[0] ?? '';
      const field = await addRequirement(db, {
        actorAccountId: actor,
        packVersionId: p.versionId,
        kind: 'FIELD',
        fieldKey: 'full_name',
        citation: 'Synthetic rule',
      });
      if (!isOk(field)) throw new Error('field');
      const saved = await setRequirementDetails(db, await staff(db, actor), {
        packRequirementId: requirementId,
        ...NO_DETAILS,
        category: 'FINANCIAL_MEANS',
        acceptedForm: 'CERTIFIED_COPY',
        translationNeeded: true,
        statementPeriodMonths: 6,
      });
      expect(isOk(saved)).toBe(true);
      const formatOnField = await setRequirementDetails(db, await staff(db, actor), {
        packRequirementId: field.value.id,
        ...NO_DETAILS,
        originalNeeded: true,
      });
      expect(isErr(formatOnField)).toBe(true);
      const outOfRange = await setRequirementDetails(db, await staff(db, actor), {
        packRequirementId: requirementId,
        ...NO_DETAILS,
        statementPeriodMonths: 61,
      });
      expect(isErr(outOfRange)).toBe(true);
      const details = (await listRequirementDetails(db, [requirementId])).get(requirementId);
      expect(details).toMatchObject({
        category: 'FINANCIAL_MEANS',
        acceptedForm: 'CERTIFIED_COPY',
        translationNeeded: true,
        originalNeeded: null,
        statementPeriodMonths: 6,
      });
      const [audit] = await db
        .select({ metadata: schema.auditEvents.metadata })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'PACK_REQUIREMENT_DETAILS_SET'));
      expect(audit?.metadata).toMatchObject({ kind: 'DOCUMENT', setCount: 4 });

      await publish(db, actor, p.versionId);
      const afterPublish = await setRequirementDetails(db, await staff(db, actor), {
        packRequirementId: requirementId,
        ...NO_DETAILS,
      });
      expect(isErr(afterPublish)).toBe(true);
      expect((await listRequirementDetails(db, [requirementId])).get(requirementId)?.category).toBe(
        'FINANCIAL_MEANS',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'never stores a field observation as Mandatory or without a non-blocking necessity',
    async () => {
      const p = await publicPack(db, actor, 'Observed');
      const base = {
        actorAccountId: actor,
        packVersionId: p.versionId,
        kind: 'DOCUMENT' as const,
        docType: 'COVER_LETTER',
        citation: 'Seen in synthetic cases',
        provenance: 'FIELD_OBSERVATION' as const,
      };
      expect(isErr(await addRequirement(db, { ...base, necessity: 'MANDATORY' }))).toBe(true);
      expect(isErr(await addRequirement(db, base))).toBe(true);
      const condition: RuleCondition = { op: 'equals', field: 'visa_purpose', value: 'business' };
      expect(
        isErr(await addRequirement(db, { ...base, necessity: 'CONDITIONAL', condition })),
      ).toBe(true);
      const ok = await addRequirement(db, { ...base, necessity: 'RECOMMENDED' });
      expect(isOk(ok) && ok.value.optional).toBe(true);
      expect(isOk(ok) && ok.value.provenance).toBe('FIELD_OBSERVATION');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('source check date (R08)', () => {
  it(
    'is the last read that reached the page, never a blocked fetch',
    async () => {
      const db = await freshDb();
      const url = 'https://example.gov/visit';
      const [source] = await db
        .insert(schema.officialSources)
        .values({
          jurisdiction: 'GB',
          url,
          title: 'Synthetic Visit Guidance',
          publisher: 'Synthetic Office',
          authorityTier: 'GOVERNMENT',
        })
        .returning();
      if (!source) throw new Error('source');
      const runs = await db
        .insert(schema.sourceCheckRuns)
        .values([
          { runKey: 'g2-1', trigger: 'MANUAL' },
          { runKey: 'g2-2', trigger: 'MANUAL' },
          { runKey: 'g2-3', trigger: 'MANUAL' },
        ])
        .returning();
      const at = (iso: string) => new Date(iso);
      await db.insert(schema.sourceObservations).values([
        {
          sourceId: source.id,
          runId: runs[0]?.id ?? '',
          fetchedAt: at('2026-10-01T00:00:00Z'),
          outcome: 'FETCHED',
          contentSha256: 'a'.repeat(64),
          normalizedSha256: 'b'.repeat(64),
        },
        {
          sourceId: source.id,
          runId: runs[1]?.id ?? '',
          fetchedAt: at('2026-10-08T00:00:00Z'),
          outcome: 'NOT_MODIFIED',
          contentSha256: 'a'.repeat(64),
          normalizedSha256: 'b'.repeat(64),
        },
        {
          sourceId: source.id,
          runId: runs[2]?.id ?? '',
          fetchedAt: at('2026-10-15T00:00:00Z'),
          outcome: 'BLOCKED',
        },
      ]);
      const checks = await latestSourceChecks(db, [url, 'https://example.gov/unknown']);
      expect(checks.get(url)?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
      expect(checks.has('https://example.gov/unknown')).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('case-aware expiry check (R22)', () => {
  let db: Db;
  let actor: string;
  let applicantId: string;
  beforeEach(async () => {
    db = await freshDb();
    ({ actor, applicantId } = await seed(db));
  });

  async function document(name: string, expiresAt: string) {
    const [doc] = await db
      .insert(schema.documents)
      .values({
        applicantId,
        originalName: name,
        docType: 'PASSPORT',
        expiresAt: new Date(expiresAt),
      })
      .returning({ id: schema.documents.id });
    if (!doc) throw new Error('document');
    return doc.id;
  }

  /** A case linked to a freshly published checklist; `validMonths` is set on its first item. */
  async function caseWith(travelEnd: string | null, requirementCount = 1, validMonths?: number) {
    const p = await publicPack(
      db,
      actor,
      `Expiry ${Math.random().toString(36).slice(2)}`,
      Array.from({ length: requirementCount }, (_, i) => `PASSPORT_${i}`),
    );
    if (validMonths !== undefined) {
      const saved = await setRequirementDetails(db, await staff(db, actor), {
        packRequirementId: p.requirementIds[0] ?? '',
        ...NO_DETAILS,
        validMonthsAfterTravel: validMonths,
      });
      if (!isOk(saved)) throw new Error('details');
    }
    await publish(db, actor, p.versionId);
    const mission = await createMission(db, {
      actorAccountId: actor,
      applicantId,
      title: 'Synthetic Case',
      ...(travelEnd ? { travelEndDate: new Date(travelEnd) } : {}),
    });
    if (!isOk(mission)) throw new Error('mission');
    const attached = await attachPackVersion(db, {
      actorAccountId: actor,
      missionId: mission.value.id,
      packVersionId: p.versionId,
    });
    if (!isOk(attached)) throw new Error(`attach: ${attached.error.message}`);
    return { missionId: mission.value.id, requirementIds: p.requirementIds };
  }

  async function choose(missionId: string, packRequirementId: string, documentId: string) {
    await db.insert(schema.selectedEvidence).values({ missionId, packRequirementId, documentId });
  }

  async function conflicts(missionId: string) {
    const gate = await requireAccess(
      db,
      accountPrincipal(actor),
      'VIEW_METADATA',
      { missionId },
      { purpose: 'self' },
    );
    if (!gate.ok) throw new Error('gate');
    return caseExpiryConflicts(gate.value);
  }

  it(
    'flags a chosen document once when it expires before the trip ends, and only on an active case',
    async () => {
      const c = await caseWith('2027-03-20T00:00:00Z', 2);
      const early = await document('passport-old.pdf', '2027-03-01T00:00:00Z');
      const fine = await document('passport-new.pdf', '2030-01-01T00:00:00Z');
      await choose(c.missionId, c.requirementIds[0] ?? '', early);
      await choose(c.missionId, c.requirementIds[1] ?? '', early);
      await choose(c.missionId, c.requirementIds[1] ?? '', fine);
      const found = await conflicts(c.missionId);
      expect(found.map((f) => f.documentId)).toEqual([early]);

      await db
        .update(schema.missions)
        .set({ state: 'CLOSED' })
        .where(eq(schema.missions.id, c.missionId));
      expect(await conflicts(c.missionId)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'respects the months the checklist says a document must stay valid after the trip',
    async () => {
      const plain = await caseWith('2027-03-20T00:00:00Z');
      const strict = await caseWith('2027-03-20T00:00:00Z', 1, 6);
      const afterTrip = await document('passport.pdf', '2027-06-01T00:00:00Z');
      await choose(plain.missionId, plain.requirementIds[0] ?? '', afterTrip);
      await choose(strict.missionId, strict.requirementIds[0] ?? '', afterTrip);
      expect(await conflicts(plain.missionId)).toEqual([]);
      const found = await conflicts(strict.missionId);
      expect(found).toHaveLength(1);
      expect(found[0]?.neededUntil.toISOString()).toBe('2027-09-20T00:00:00.000Z');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'ignores a choice left from another checklist, and answers only the case owner',
    async () => {
      const c = await caseWith('2027-03-20T00:00:00Z');
      const other = await publicPack(db, actor, 'Other Checklist', ['OLD_PASSPORT']);
      const early = await document('passport-old.pdf', '2027-01-01T00:00:00Z');
      await choose(c.missionId, other.requirementIds[0] ?? '', early);
      expect(await conflicts(c.missionId)).toEqual([]);
      await choose(c.missionId, c.requirementIds[0] ?? '', early);
      expect(await conflicts(c.missionId)).toHaveLength(1);
      const forged = await caseExpiryConflicts({} as never);
      expect(forged).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'never guesses a travel end date it does not have',
    async () => {
      const c = await caseWith(null);
      const early = await document('passport.pdf', '2026-01-01T00:00:00Z');
      await choose(c.missionId, c.requirementIds[0] ?? '', early);
      expect(await conflicts(c.missionId)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('past applications (R18)', () => {
  it('are catalogue fields on the profile, never read by matching', () => {
    const keys = CATALOGUE_FIELDS.map((f) => f.key).filter((k) =>
      k.startsWith('past_application_'),
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'past_application_country',
        'past_application_visa_type',
        'past_application_date_applied',
        'past_application_post',
        'past_application_outcome',
      ]),
    );
    const outcome = CATALOGUE_FIELDS.find((f) => f.key === 'past_application_outcome');
    expect(outcome?.options).toEqual(
      expect.arrayContaining(['Pending', 'Granted', 'Refused', 'Withdrawn', 'Unknown']),
    );
    // Nothing that chooses or predicts reads them.
    for (const file of ['pack-matching.ts', 'umpe-insights-service.ts', 'missions.ts']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(source.includes('past_application'), file).toBe(false);
    }
  });

  it(
    'save on the profile and leave matching and coverage unchanged',
    async () => {
      const db = await freshDb();
      const { actor, applicantId } = await seed(db);
      const p = await publicPack(db, actor, 'Unchanged');
      await publish(db, actor, p.versionId);
      const mission = await createMission(db, {
        actorAccountId: actor,
        applicantId,
        title: 'Trip',
      });
      if (!isOk(mission)) throw new Error('mission');
      const gate = async () => {
        const g = await requireAccess(
          db,
          accountPrincipal(actor),
          'MANAGE',
          { missionId: mission.value.id },
          { purpose: 'owner_checklist_match' },
        );
        if (!g.ok) throw new Error('gate');
        return g.value;
      };
      const before = {
        coverage: await readTravellerCoverage(await gate()),
        match: await findMatchingPublicPack(db, ukTrip),
      };
      for (const [key, value] of [
        ['past_application_country', 'United Kingdom'],
        ['past_application_outcome', 'Refused'],
      ] as const) {
        await registerFieldDefinition(db, { key, dataType: 'string', repeating: true });
        const saved = await editFact(db, {
          actorAccountId: actor,
          applicantId,
          fieldKey: key,
          value,
        });
        if (!isOk(saved)) throw new Error(`fact: ${saved.error.message}`);
      }
      const stored = await db
        .select({ id: schema.facts.id })
        .from(schema.facts)
        .innerJoin(
          schema.fieldDefinitions,
          eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
        )
        .where(
          and(
            eq(schema.facts.applicantId, applicantId),
            eq(schema.fieldDefinitions.key, 'past_application_outcome'),
          ),
        );
      expect(stored).toHaveLength(1);
      expect(await readTravellerCoverage(await gate())).toEqual(before.coverage);
      expect(await findMatchingPublicPack(db, ukTrip)).toEqual(before.match);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('published rules stay fixed: details and route conditions are versioned (S04)', () => {
  let db: Db;
  let actor: string;
  let applicantId: string;
  beforeEach(async () => {
    db = await freshDb();
    ({ actor, applicantId } = await seed(db));
  });

  it(
    'keeps the exact checksum of a version without details, and seals details into a new one',
    async () => {
      const plain = await publicPack(db, actor, 'Plain Checksum');
      const rows = await listRequirements(db, plain.versionId);
      // No details and no conditions: format 1 and format 2 bytes are exactly as before.
      const empty = { details: new Map(), routeConditions: null };
      expect(buildManifest(rows, 1, empty)).toEqual(buildManifest(rows, 1));
      expect(buildManifest(rows, 2, empty)).toEqual(buildManifest(rows, 2));
      await publish(db, actor, plain.versionId);
      const [stored] = await db
        .select({
          checksum: schema.packVersions.checksum,
          format: schema.packVersions.manifestFormat,
        })
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, plain.versionId));
      expect(stored?.format).toBe(1);
      expect(stored?.checksum).toBe(buildManifest(rows, 1).checksum);
      expect(await verifyPackChecksum(db, plain.versionId)).toBe(true);

      const detailed = await publicPack(db, actor, 'Detailed Checksum');
      await setRequirementDetails(db, await staff(db, actor), {
        packRequirementId: detailed.requirementIds[0] ?? '',
        ...NO_DETAILS,
        acceptedForm: 'CERTIFIED_COPY',
      });
      await publish(db, actor, detailed.versionId);
      const [sealed] = await db
        .select({
          format: schema.packVersions.manifestFormat,
          manifest: schema.packVersions.manifest,
        })
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, detailed.versionId));
      expect(sealed?.format).toBe(2);
      expect(JSON.stringify(sealed?.manifest)).toContain('CERTIFIED_COPY');
      expect(await verifyPackChecksum(db, detailed.versionId)).toBe(true);
      // A change written around the service is caught by the checksum.
      await db
        .update(schema.packRequirementDetails)
        .set({ acceptedForm: 'DIGITAL_COPY' })
        .where(
          eq(schema.packRequirementDetails.packRequirementId, detailed.requirementIds[0] ?? ''),
        );
      expect(await verifyPackChecksum(db, detailed.versionId)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses details on a published version; a changed draft publishes as a new version P11 flags',
    async () => {
      const v1 = await publicPack(db, actor, 'Impact Pack');
      await publish(db, actor, v1.versionId);
      const refused = await setRequirementDetails(db, await staff(db, actor), {
        packRequirementId: v1.requirementIds[0] ?? '',
        ...NO_DETAILS,
        validMonthsAfterTravel: 6,
      });
      expect(isErr(refused)).toBe(true);

      const mission = await createMission(db, {
        actorAccountId: actor,
        applicantId,
        title: 'Trip',
      });
      if (!isOk(mission)) throw new Error('mission');
      const attached = await attachPackVersion(db, {
        actorAccountId: actor,
        missionId: mission.value.id,
        packVersionId: v1.versionId,
      });
      if (!isOk(attached)) throw new Error('attach');

      const v2 = await addPackVersion(db, { actorAccountId: actor, packId: v1.packId });
      if (!isOk(v2)) throw new Error('v2');
      const added = await addRequirement(db, {
        actorAccountId: actor,
        packVersionId: v2.value.id,
        kind: 'DOCUMENT',
        docType: 'PASSPORT',
        citation: 'Synthetic rule',
      });
      if (!isOk(added)) throw new Error('requirement');
      await setRequirementDetails(db, await staff(db, actor), {
        packRequirementId: added.value.id,
        ...NO_DETAILS,
        validMonthsAfterTravel: 6,
        category: 'IDENTITY_TRAVEL_DOCUMENTS',
      });
      await publish(db, actor, v2.value.id);

      const diff = await diffPackVersions(db, v1.versionId, v2.value.id);
      if (!isOk(diff)) throw new Error('diff');
      expect(diff.value.entries[0]?.changedFields).toEqual(
        expect.arrayContaining(['validMonthsAfterTravel', 'category']),
      );
      expect(diff.value.routeConditionsChanged).toBe(false);
      const assessed = await assessRuleImpact(db, await staff(db, actor), {
        packVersionId: v2.value.id,
      });
      expect(isOk(assessed) && assessed.value.casesFlagged).toBe(1);
      const impacts = await db.select().from(schema.umpeRuleImpacts);
      expect(impacts.map((i) => i.missionId)).toEqual([mission.value.id]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('editing a case post or travel dates re-checks its checklist (R05, P4)', () => {
  it(
    'records one change when the linked checklist no longer fits or needs a value, and leaves handoffs alone',
    async () => {
      const db = await freshDb();
      const { actor, applicantId } = await seed(db);
      const p = await publicPack(db, actor, 'Dhaka Checklist');
      await setPackRouteConditions(db, await staff(db, actor), {
        packVersionId: p.versionId,
        consularPosts: ['Dhaka'],
        travelFrom: null,
        travelUntil: null,
      });
      await publish(db, actor, p.versionId);
      const mission = await createMission(db, {
        actorAccountId: actor,
        applicantId,
        title: 'Trip',
        jurisdiction: 'British High Commission Dhaka',
      });
      if (!isOk(mission)) throw new Error('mission');
      const missionId = mission.value.id;
      const attached = await attachPackVersion(db, {
        actorAccountId: actor,
        missionId,
        packVersionId: p.versionId,
      });
      if (!isOk(attached)) throw new Error('attach');
      const snapshot = await snapshotMission(db, { actorAccountId: actor, missionId });
      if (!isOk(snapshot)) throw new Error('snapshot');
      await db.insert(schema.umpePackageHandoffs).values({
        missionId,
        applicantId,
        missionSnapshotId: snapshot.value.id,
        packVersionId: p.versionId,
        materialRevisionAtCapture: 0,
        content: { synthetic: true },
        contentChecksum: 'c'.repeat(64),
      });
      const handoffsBefore = await db.select().from(schema.umpePackageHandoffs);

      const open = async () => {
        const gate = await requireAccess(
          db,
          accountPrincipal(actor),
          'VIEW_METADATA',
          { missionId },
          { purpose: 'self' },
        );
        if (!gate.ok) throw new Error('gate');
        return getCasePackage(gate.value, missionId);
      };
      const changes = () =>
        db
          .select()
          .from(schema.umpePackageChanges)
          .where(eq(schema.umpePackageChanges.missionId, missionId));

      await open();
      expect(await changes()).toEqual([]);

      const edit = async (jurisdiction: string) => {
        const updated = await updateMissionCaseDetails(db, {
          actorAccountId: actor,
          missionId,
          jurisdiction,
        });
        if (!isOk(updated)) throw new Error('edit');
        await open();
      };
      await edit('British Embassy Chattogram');
      let rows = await changes();
      expect(rows.map((r) => [r.kind, r.resolvedAt])).toEqual([['CASE_DETAILS_CHANGED', null]]);
      // Opening again, or a missing post (the checklist now needs it), keeps the one item.
      await open();
      await edit('');
      rows = await changes();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.changeCount).toBe(1);
      // Back to a post that fits: the item clears.
      await edit('Dhaka');
      rows = await changes();
      expect(rows[0]?.resolvedAt).not.toBeNull();
      expect(await db.select().from(schema.umpePackageHandoffs)).toEqual(handoffsBefore);
    },
    TEST_TIMEOUT_MS,
  );
});
