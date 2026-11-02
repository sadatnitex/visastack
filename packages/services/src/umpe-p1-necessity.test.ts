/**
 * UMPE P1 (R02-R07): honest necessity, alternatives and the versioned manifest (ADR 0026 D2, D3).
 *
 * Pins, with synthetic data only:
 * 1. Format 2 manifests: exact bytes and a hard-coded checksum, new keys only when set, legacy
 *    rows unaffected, and the format chosen and stored at approval.
 * 2. Authoring checks: Mandatory If It Applies needs a rule, a group needs its mode, the stored
 *    optional flag follows the necessity, and approval and publication re-check every row.
 * 3. Readiness: two alternatives satisfy one group without double counting, a recommended item
 *    never blocks, an unknown condition is Unverified, an invalid format 2 condition fails closed
 *    while a format 1 version keeps today's reading.
 * 4. The requirement vocabulary never mixes with sharing categories.
 * 5. Before migration 0116 runs, reads still work and Pack Studio waits.
 */
import { readFileSync } from 'node:fs';
import {
  NECESSITY_LABELS,
  PROFILE_PACKS,
  REQUIREMENT_GROUP_MODES,
  REQUIREMENT_NECESSITIES,
  REQUIREMENT_PROVENANCES,
  isErr,
  isOk,
} from '@visastack/core';
import { SHARING_CATEGORIES } from '@visastack/core/catalogue/packs';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { attachPackVersion, computeReadiness, createMission } from './missions';
import {
  type PackRequirement,
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  buildManifest,
  createPack,
  getPackVersion,
  listPackVersions,
  listRequirements,
  publishPackVersion,
  resetPackRuleColumnsCheckForTests,
  verifyPackChecksum,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';

const TEST_TIMEOUT_MS = 60_000;

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

/** Synthetic format 2 rows: a group of two alternatives, a recommended item, a conditional item. */
const V2_ROWS = [
  {
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'sponsor_letter',
    citation: 'Synthetic rule 3',
    optional: false,
    necessity: 'MANDATORY',
    provenance: null,
    groupKey: 'funds',
    groupMode: 'ANY_OF',
    condition: null,
  },
  {
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'bank_statement',
    citation: 'Synthetic rule 3',
    optional: false,
    necessity: 'MANDATORY',
    provenance: 'OFFICIAL',
    groupKey: 'funds',
    groupMode: 'ANY_OF',
    condition: null,
  },
  {
    kind: 'FIELD',
    fieldKey: 'employer.name',
    docType: null,
    citation: 'Synthetic rule 4',
    optional: false,
    necessity: 'CONDITIONAL',
    provenance: 'AUTHORITY_REQUESTED',
    groupKey: null,
    groupMode: null,
    // Keys deliberately out of order: the manifest sorts them.
    condition: { value: 'business', op: 'equals', field: 'visa_purpose' },
  },
  {
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'Hotel_Booking',
    citation: 'Synthetic note É',
    optional: true,
    necessity: 'RECOMMENDED',
    provenance: 'AGENCY_ADDED',
    groupKey: null,
    groupMode: null,
    condition: null,
  },
  {
    kind: 'FIELD',
    fieldKey: 'passport.number',
    docType: null,
    citation: 'Synthetic rule 1',
    optional: false,
    necessity: null,
    provenance: null,
    groupKey: null,
    groupMode: null,
    condition: null,
  },
] as const;

const V2_MANIFEST_JSON =
  '{"formatVersion":2,"requirements":[' +
  '{"kind":"DOCUMENT","fieldKey":null,"docType":"Hotel_Booking","citation":"Synthetic note É","optional":true,"necessity":"RECOMMENDED","provenance":"AGENCY_ADDED"},' +
  '{"kind":"DOCUMENT","fieldKey":null,"docType":"bank_statement","citation":"Synthetic rule 3","optional":false,"necessity":"MANDATORY","provenance":"OFFICIAL","groupKey":"funds","groupMode":"ANY_OF"},' +
  '{"kind":"DOCUMENT","fieldKey":null,"docType":"sponsor_letter","citation":"Synthetic rule 3","optional":false,"necessity":"MANDATORY","groupKey":"funds","groupMode":"ANY_OF"},' +
  '{"kind":"FIELD","fieldKey":"employer.name","docType":null,"citation":"Synthetic rule 4","optional":false,"necessity":"CONDITIONAL","provenance":"AUTHORITY_REQUESTED","condition":{"field":"visa_purpose","op":"equals","value":"business"}},' +
  '{"kind":"FIELD","fieldKey":"passport.number","docType":null,"citation":"Synthetic rule 1","optional":false}' +
  ']}';

const V2_CHECKSUM = '97ba8ed000213649033cf04e6673444279fffe3394020210a9d557043738c842';

function v2Rows(): PackRequirement[] {
  return V2_ROWS.map((r) => ({ ...r }) as unknown as PackRequirement);
}

describe('UMPE P1: format 2 manifest', () => {
  it('serializes to the exact frozen bytes and checksum', () => {
    const { manifest, checksum } = buildManifest(v2Rows(), 2);
    expect(JSON.stringify(manifest)).toBe(V2_MANIFEST_JSON);
    expect(checksum).toBe(V2_CHECKSUM);
  });

  it('does not depend on row order or on the key order of a stored condition', () => {
    const reversed = [...v2Rows()].reverse();
    expect(buildManifest(reversed, 2).checksum).toBe(V2_CHECKSUM);
  });

  it('format 1 ignores every new field, so an old version keeps its bytes', () => {
    const legacy = v2Rows().map(
      (r) =>
        ({
          kind: r.kind,
          fieldKey: r.fieldKey,
          docType: r.docType,
          citation: r.citation,
          optional: r.optional,
        }) as unknown as PackRequirement,
    );
    expect(JSON.stringify(buildManifest(v2Rows()).manifest)).toBe(
      JSON.stringify(buildManifest(legacy).manifest),
    );
    expect(JSON.stringify(buildManifest(v2Rows()).manifest)).not.toContain('necessity');
  });
});

async function seed(db: Db) {
  const author = await provisionAccount(db, { email: 'p1-author@example.com' });
  const reviewer = await provisionAccount(db, { email: 'p1-reviewer@example.com' });
  if (!isOk(author) || !isOk(reviewer)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: author.value.id,
    accountId: author.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: author.value.id,
    ownerAccountId: author.value.id,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { actor: author.value.id, applicantId: applicant.value.id };
}

type Row = Omit<RequirementInput, 'citation'> & { readonly citation?: string };

async function draftWith(db: Db, actor: string, rows: readonly Row[]) {
  const pack = await createPack(db, {
    actorAccountId: actor,
    key: `p1.${Math.random().toString(36).slice(2)}`,
    name: 'P1 Synthetic',
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
  return version.value.id;
}

async function publish(db: Db, actor: string, versionId: string) {
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
}

async function caseOn(db: Db, actor: string, applicantId: string, versionId: string) {
  const mission = await createMission(db, {
    actorAccountId: actor,
    applicantId,
    title: 'Synthetic Case',
  });
  if (!isOk(mission)) throw new Error('mission');
  const attached = await attachPackVersion(db, {
    actorAccountId: actor,
    missionId: mission.value.id,
    packVersionId: versionId,
  });
  if (!isOk(attached)) throw new Error('attach');
  return mission.value.id;
}

async function fact(db: Db, actor: string, applicantId: string, key: string, value: string) {
  await registerFieldDefinition(db, { key, dataType: 'string' });
  const edited = await editFact(db, { actorAccountId: actor, applicantId, fieldKey: key, value });
  if (!isOk(edited)) throw new Error(`fact ${key}`);
}

async function readiness(db: Db, missionId: string) {
  const result = await computeReadiness(db, missionId);
  if (!isOk(result)) throw new Error('readiness');
  return result.value;
}

const FIELD = (fieldKey: string, extra: Partial<RequirementInput> = {}): Row => ({
  kind: 'FIELD',
  fieldKey,
  ...extra,
});

describe('UMPE P1: authoring and approval', () => {
  let db: Db;
  let actor: string;
  beforeEach(async () => {
    db = await freshDb();
    ({ actor } = await seed(db));
  }, TEST_TIMEOUT_MS);

  async function refused(row: Row): Promise<string> {
    const versionId = await draftWith(db, actor, []);
    const result = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      citation: 'Synthetic rule',
      ...row,
    });
    if (!isErr(result)) throw new Error('expected a refusal');
    expect(result.error.code).toBe('invalid');
    return result.error.message;
  }

  it('refuses rule fields that do not add up', async () => {
    expect(await refused(FIELD('a', { necessity: 'CONDITIONAL' }))).toMatch(/rule saying when/);
    expect(
      await refused(
        FIELD('a', {
          necessity: 'MANDATORY',
          condition: { op: 'exists', field: 'sponsor.name' },
        }),
      ),
    ).toMatch(/Mandatory If It Applies/);
    expect(await refused(FIELD('a', { groupKey: 'funds' }))).toMatch(/group/);
    expect(await refused(FIELD('a', { groupMode: 'ANY_OF' }))).toMatch(/group/);
    expect(await refused(FIELD('a', { groupKey: '  ', groupMode: 'ANY_OF' }))).toMatch(/name/);
    expect(await refused(FIELD('a', { necessity: 'RECOMMENDED', optional: false }))).toMatch(
      /optional flag/,
    );
    expect(
      await refused(FIELD('a', { necessity: 'ALTERNATIVE_GROUP' as unknown as 'OPTIONAL' })),
    ).toMatch(/necessity/);
    expect(
      await refused(FIELD('a', { provenance: 'ADDITIONAL_REQUEST' as unknown as 'OFFICIAL' })),
    ).toMatch(/who asked/);
    expect(
      await refused(FIELD('a', { groupKey: 'funds', groupMode: 'ALL_OF' as unknown as 'ANY_OF' })),
    ).toMatch(/any one/);
  });

  it('stores the optional flag the necessity implies, so older readers agree', async () => {
    const versionId = await draftWith(db, actor, [
      FIELD('a', { necessity: 'RECOMMENDED' }),
      FIELD('b', { necessity: 'OPTIONAL' }),
      FIELD('c', { necessity: 'MANDATORY' }),
      FIELD('d', {
        necessity: 'CONDITIONAL',
        condition: { op: 'exists', field: 'sponsor.name' },
      }),
      FIELD('e', { optional: true }),
    ]);
    const rows = await listRequirements(db, versionId);
    const byKey = Object.fromEntries(rows.map((r) => [r.fieldKey, [r.optional, r.necessity]]));
    expect(byKey).toEqual({
      a: [true, 'RECOMMENDED'],
      b: [true, 'OPTIONAL'],
      c: [false, 'MANDATORY'],
      d: [false, 'CONDITIONAL'],
      e: [true, null],
    });
  });

  it(
    'a version with no new field is approved as format 1 and keeps verifying, also as an old version',
    async () => {
      const versionId = await draftWith(db, actor, [FIELD('a'), FIELD('b', { optional: true })]);
      await publish(db, actor, versionId);
      const version = await getPackVersion(db, versionId);
      expect(version?.manifestFormat).toBe(1);
      expect(version?.manifest).not.toHaveProperty('formatVersion');
      expect(await verifyPackChecksum(db, versionId)).toBe(true);
      // A version approved before migration 0116 has no recorded format: NULL means format 1.
      await db
        .update(schema.packVersions)
        .set({ manifestFormat: null })
        .where(eq(schema.packVersions.id, versionId));
      expect(await verifyPackChecksum(db, versionId)).toBe(true);
      // An unknown format is never verified.
      await db
        .update(schema.packVersions)
        .set({ manifestFormat: 3 })
        .where(eq(schema.packVersions.id, versionId));
      expect(await verifyPackChecksum(db, versionId)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a version using a new field is approved as format 2 and detects tampering with it',
    async () => {
      const versionId = await draftWith(db, actor, [
        FIELD('a', { groupKey: 'id', groupMode: 'ANY_OF', necessity: 'MANDATORY' }),
        FIELD('b', { groupKey: 'id', groupMode: 'ANY_OF', necessity: 'MANDATORY' }),
      ]);
      await publish(db, actor, versionId);
      const version = await getPackVersion(db, versionId);
      expect(version?.manifestFormat).toBe(2);
      expect(version?.manifest).toMatchObject({ formatVersion: 2 });
      expect(await verifyPackChecksum(db, versionId)).toBe(true);
      const [first] = await listRequirements(db, versionId);
      if (!first) throw new Error('rows');
      await db
        .update(schema.packRequirements)
        .set({ groupKey: 'other' })
        .where(eq(schema.packRequirements.id, first.id));
      expect(await verifyPackChecksum(db, versionId)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'approval and publication refuse an invalid stored condition and a lone group member',
    async () => {
      const invalid = await draftWith(db, actor, [
        FIELD('a', { condition: { op: 'exists', field: 'sponsor.name' } }),
      ]);
      const [row] = await listRequirements(db, invalid);
      if (!row) throw new Error('rows');
      await db
        .update(schema.packRequirements)
        .set({ condition: { op: 'eval', code: 'true' } })
        .where(eq(schema.packRequirements.id, row.id));
      const approve = await approvePackVersion(db, {
        actorAccountId: actor,
        packVersionId: invalid,
      });
      expect(isErr(approve) && approve.error.message).toMatch(/recognised shape/);

      const lone = await draftWith(db, actor, [
        FIELD('a', { groupKey: 'solo', groupMode: 'ANY_OF' }),
      ]);
      const approveLone = await approvePackVersion(db, {
        actorAccountId: actor,
        packVersionId: lone,
      });
      expect(isErr(approveLone) && approveLone.error.message).toMatch(/at least two/);

      // Approved while valid, then the stored row changed: publication checks again.
      const later = await draftWith(db, actor, [
        FIELD('a', { condition: { op: 'exists', field: 'sponsor.name' } }),
      ]);
      const approved = await approvePackVersion(db, {
        actorAccountId: actor,
        packVersionId: later,
      });
      expect(isOk(approved)).toBe(true);
      const [laterRow] = await listRequirements(db, later);
      if (!laterRow) throw new Error('rows');
      await db
        .update(schema.packRequirements)
        .set({ condition: { op: 'exists' } })
        .where(eq(schema.packRequirements.id, laterRow.id));
      const published = await publishPackVersion(db, {
        actorAccountId: actor,
        packVersionId: later,
      });
      expect(isErr(published) && published.error.message).toMatch(/recognised shape/);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('UMPE P1: readiness with necessity and alternatives', () => {
  let db: Db;
  let actor: string;
  let applicantId: string;
  beforeEach(async () => {
    db = await freshDb();
    ({ actor, applicantId } = await seed(db));
  }, TEST_TIMEOUT_MS);

  it(
    'two alternatives satisfy one group once, and a missing group is one missing entry',
    async () => {
      const versionId = await draftWith(db, actor, [
        FIELD('passport.number', { necessity: 'MANDATORY' }),
        FIELD('funds.bank', { necessity: 'MANDATORY', groupKey: 'funds', groupMode: 'ANY_OF' }),
        FIELD('funds.sponsor', {
          necessity: 'MANDATORY',
          groupKey: 'funds',
          groupMode: 'ANY_OF',
        }),
      ]);
      await publish(db, actor, versionId);
      const missionId = await caseOn(db, actor, applicantId, versionId);

      const before = await readiness(db, missionId);
      expect(before.requiredCount).toBe(2);
      expect(before.missing).toHaveLength(2);
      const group = before.missing.find((m) => m.groupKey === 'funds');
      expect(group?.alternatives?.map((a) => a.key)).toEqual(['funds.bank', 'funds.sponsor']);
      expect(group?.optional).toBe(false);
      expect(before.overallState).toBe('NEEDS_ACTION');

      await fact(db, actor, applicantId, 'passport.number', 'P1-0001');
      await fact(db, actor, applicantId, 'funds.sponsor', 'Synthetic Sponsor');
      const one = await readiness(db, missionId);
      expect(one.requiredCount).toBe(2);
      expect(one.satisfiedRequired).toBe(2);
      expect(one.missing).toEqual([]);
      expect(one.ready).toBe(true);
      expect(one.overallState).toBe('READY_FOR_APPLICANT_REVIEW');
      // The other alternative is not needed now, so it is never a gap.
      const bank = one.requirementResults.find((r) => r.key === 'funds.bank');
      expect(bank).toMatchObject({ state: 'ATTENTION', optional: true, groupKey: 'funds' });

      // Both alternatives present still counts the group once.
      await fact(db, actor, applicantId, 'funds.bank', 'Synthetic Bank');
      const both = await readiness(db, missionId);
      expect(both.requiredCount).toBe(2);
      expect(both.satisfiedRequired).toBe(2);
      expect(both.ready).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a recommended or optional item never blocks, alone or as the only kind in a group',
    async () => {
      const versionId = await draftWith(db, actor, [
        FIELD('passport.number', { necessity: 'MANDATORY' }),
        FIELD('hotel.booking', { necessity: 'RECOMMENDED', provenance: 'AGENCY_ADDED' }),
        FIELD('extra.a', { necessity: 'OPTIONAL', groupKey: 'extras', groupMode: 'ANY_OF' }),
        FIELD('extra.b', { necessity: 'RECOMMENDED', groupKey: 'extras', groupMode: 'ANY_OF' }),
      ]);
      await publish(db, actor, versionId);
      const missionId = await caseOn(db, actor, applicantId, versionId);
      await fact(db, actor, applicantId, 'passport.number', 'P1-0002');
      const result = await readiness(db, missionId);
      expect(result.requiredCount).toBe(1);
      expect(result.ready).toBe(true);
      expect(result.overallState).toBe('READY_FOR_APPLICANT_REVIEW');
      expect(result.missing.every((m) => m.optional)).toBe(true);
      const hotel = result.requirementResults.find((r) => r.key === 'hotel.booking');
      expect(hotel).toMatchObject({
        state: 'ATTENTION',
        necessity: 'RECOMMENDED',
        provenance: 'AGENCY_ADDED',
      });
      expect(NECESSITY_LABELS[hotel?.necessity ?? 'MANDATORY']).toBe('Recommended');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a conditional item with an unknown condition is Unverified, never satisfied or not applicable',
    async () => {
      const versionId = await draftWith(db, actor, [
        FIELD('passport.number', { necessity: 'MANDATORY' }),
        FIELD('employer.name', {
          necessity: 'CONDITIONAL',
          condition: { op: 'equals', field: 'visa_purpose', value: 'business' },
        }),
      ]);
      await publish(db, actor, versionId);
      const missionId = await caseOn(db, actor, applicantId, versionId);
      await fact(db, actor, applicantId, 'passport.number', 'P1-0003');

      const unknown = await readiness(db, missionId);
      const employer = () => unknown.requirementResults.find((r) => r.key === 'employer.name');
      expect(employer()?.state).toBe('UNVERIFIED');
      expect(unknown.ready).toBe(false);
      expect(unknown.overallState).toBe('NEEDS_REVIEW');

      await fact(db, actor, applicantId, 'visa_purpose', 'business');
      const applies = await readiness(db, missionId);
      expect(applies.requirementResults.find((r) => r.key === 'employer.name')?.state).toBe(
        'CRITICAL_GAP',
      );
      expect(applies.overallState).toBe('NEEDS_ACTION');

      await fact(db, actor, applicantId, 'visa_purpose', 'tourism');
      const notApplicable = await readiness(db, missionId);
      expect(notApplicable.requirementResults.find((r) => r.key === 'employer.name')?.state).toBe(
        'NOT_APPLICABLE',
      );
      expect(notApplicable.ready).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'an invalid stored condition fails closed in a format 2 version and keeps its old reading in format 1',
    async () => {
      const corrupt = async (versionId: string) => {
        const rows = await listRequirements(db, versionId);
        const target = rows.find((r) => r.fieldKey === 'employer.name');
        if (!target) throw new Error('rows');
        await db
          .update(schema.packRequirements)
          .set({ condition: { op: 'eval', code: 'false' } })
          .where(eq(schema.packRequirements.id, target.id));
      };
      const condition = { op: 'exists', field: 'sponsor.name' } as const;

      const v2 = await draftWith(db, actor, [
        FIELD('passport.number', { necessity: 'MANDATORY' }),
        FIELD('employer.name', { necessity: 'CONDITIONAL', condition }),
      ]);
      await publish(db, actor, v2);
      await corrupt(v2);
      const v2Case = await caseOn(db, actor, applicantId, v2);
      await fact(db, actor, applicantId, 'passport.number', 'P1-0004');
      const strict = await readiness(db, v2Case);
      expect(strict.requirementResults.find((r) => r.key === 'employer.name')?.state).toBe(
        'UNVERIFIED',
      );
      expect(strict.ready).toBe(false);
      expect(strict.overallState).toBe('NEEDS_REVIEW');

      const v1 = await draftWith(db, actor, [
        FIELD('passport.number'),
        FIELD('employer.name', { condition }),
      ]);
      await publish(db, actor, v1);
      await corrupt(v1);
      const v1Case = await caseOn(db, actor, applicantId, v1);
      const legacy = await readiness(db, v1Case);
      // Format 1 keeps today's reading: the item is demanded as if it had no condition.
      expect(legacy.requirementResults.find((r) => r.key === 'employer.name')?.state).toBe(
        'CRITICAL_GAP',
      );
      expect(legacy.requirementResults[0]).not.toHaveProperty('necessity');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('UMPE P1: requirement words never act as sharing categories', () => {
  it('shares no word with the sharing or profile pack vocabularies', () => {
    const requirementWords = new Set<string>([
      ...REQUIREMENT_NECESSITIES,
      ...REQUIREMENT_PROVENANCES,
      ...REQUIREMENT_GROUP_MODES,
    ]);
    for (const word of [...SHARING_CATEGORIES, ...PROFILE_PACKS]) {
      expect(requirementWords.has(word)).toBe(false);
      expect(requirementWords.has(word.toUpperCase())).toBe(false);
    }
  });

  it('no grant or sharing scope module reads requirement necessity', () => {
    for (const file of ['sharing.ts', 'access/grant-scope.ts', 'agency.ts']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/requirement-necessity|necessityCanBlock|REQUIREMENT_NECESSITIES/);
      expect(source).not.toMatch(/\.necessity\b|groupKey|\.provenance\b/);
    }
  });
});

describe('UMPE P1: before migration 0116 runs', () => {
  let db: Db;
  let actor: string;
  let applicantId: string;
  let versionId: string;
  beforeEach(async () => {
    db = await freshDb();
    ({ actor, applicantId } = await seed(db));
    versionId = await draftWith(db, actor, [
      FIELD('passport.number'),
      FIELD('middle.name', {
        optional: true,
      }),
    ]);
    await publish(db, actor, versionId);
    await db
      .update(schema.packVersions)
      .set({ manifestFormat: null })
      .where(eq(schema.packVersions.id, versionId));
    await db.execute(sql`
      alter table pack_requirements drop column necessity, drop column provenance,
        drop column group_key, drop column group_mode`);
    await db.execute(sql`alter table pack_versions drop column manifest_format`);
    resetPackRuleColumnsCheckForTests();
  }, TEST_TIMEOUT_MS);
  afterEach(() => {
    resetPackRuleColumnsCheckForTests();
  });

  it(
    'reads packs and readiness exactly as before, and Pack Studio waits',
    async () => {
      const rows = await listRequirements(db, versionId);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.necessity === null && r.groupKey === null)).toBe(true);
      expect((await getPackVersion(db, versionId))?.manifestFormat).toBeNull();
      expect(
        await listPackVersions(db, (await getPackVersion(db, versionId))?.packId ?? ''),
      ).toHaveLength(1);
      expect(await verifyPackChecksum(db, versionId)).toBe(true);

      const missionId = await caseOn(db, actor, applicantId, versionId);
      await fact(db, actor, applicantId, 'passport.number', 'P1-0005');
      const result = await readiness(db, missionId);
      expect(result.ready).toBe(true);
      expect(result.requirementResults.map((r) => r.state).sort()).toEqual([
        'ATTENTION',
        'SATISFIED',
      ]);

      const draft = await addPackVersion(db, {
        actorAccountId: actor,
        packId: (await getPackVersion(db, versionId))?.packId ?? '',
      });
      expect(isErr(draft) && draft.error.message).toMatch(/waiting for a database update/);
    },
    TEST_TIMEOUT_MS,
  );
});
