import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  type TravellerMatchTerms,
  explainNoFittingPack,
  findMatchingPublicPack,
  listFittingPublicPacks,
  listFittingStarterPacks,
  packMatchKey,
  readTravellerCoverage,
} from './pack-matching';
import { editFact, registerFieldDefinition } from './profile';

const UK = ['GB', 'United Kingdom', 'UK', 'Britain'];
const TOURISM = ['tourism', 'Tourism'];
const NONE = { terms: [], known: false };
const UNKNOWN: TravellerMatchTerms = { nationality: NONE, residence: NONE };
const BD = { terms: ['Bangladeshi', 'BD', 'Bangladesh'], known: true };
const BANGLADESHI: TravellerMatchTerms = { nationality: BD, residence: BD };
const ukTrip = (traveller: TravellerMatchTerms = UNKNOWN) => ({
  country: UK,
  purpose: TOURISM,
  traveller,
});

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

describe('packMatchKey', () => {
  it('ignores case, accents and punctuation', () => {
    expect(packMatchKey('  Côte d’Ivoire ')).toBe('cote d ivoire');
    expect(packMatchKey('family_or_friends_visit')).toBe(packMatchKey('Family or Friends Visit'));
    expect(packMatchKey('---')).toBe('');
  });
});

describe('findMatchingPublicPack', () => {
  let db: Db;
  let n = 0;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function pack(input: {
    readonly jurisdiction: string | null;
    readonly purpose: string | null;
    readonly status?: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';
    readonly versions?: readonly number[];
    readonly organizationId?: string;
    readonly nationality?: readonly string[];
    readonly residence?: readonly string[];
    readonly authoritative?: boolean;
    readonly route?: string;
    readonly key?: string;
  }) {
    n += 1;
    const [row] = await db
      .insert(schema.packs)
      .values({
        key: input.key ?? `synthetic.pack.${n}`,
        name: `Synthetic Pack ${n}`,
        jurisdiction: input.jurisdiction,
        purpose: input.purpose,
        ownerOrganizationId: input.organizationId ?? null,
        nationalityApplicability: input.nationality ? [...input.nationality] : null,
        residenceApplicability: input.residence ? [...input.residence] : null,
        authoritative: input.authoritative ?? true,
        route: input.route ?? null,
      })
      .returning();
    if (!row) throw new Error('pack');
    const ids: string[] = [];
    for (const version of input.versions ?? [1]) {
      const [v] = await db
        .insert(schema.packVersions)
        .values({ packId: row.id, version, status: input.status ?? 'PUBLISHED' })
        .returning();
      if (!v) throw new Error('version');
      ids.push(v.id);
    }
    return { name: row.name, versionIds: ids };
  }

  it('links the one published pack for the country and purpose, whatever names it uses', async () => {
    const uk = await pack({ jurisdiction: 'UK', purpose: 'Tourism' });
    await pack({ jurisdiction: 'United Kingdom', purpose: 'study' });
    await pack({ jurisdiction: 'Canada', purpose: 'tourism' });
    expect(await findMatchingPublicPack(db, ukTrip())).toEqual({
      packVersionId: uk.versionIds[0],
      packName: uk.name,
      version: 1,
      coversTraveller: true,
      coversRoute: true,
    });
  });

  describe('starter checklists', () => {
    it('are found for the route on their own list and never linked or counted as reviewed', async () => {
      const starter = await pack({
        key: 'starter.gb.tourist',
        jurisdiction: 'GB',
        purpose: 'tourism',
        authoritative: false,
      });
      await pack({
        key: 'starter.fr.tourist',
        jurisdiction: 'FR',
        purpose: 'tourism',
        authoritative: false,
      });
      expect(await listFittingStarterPacks(db, ukTrip())).toEqual([
        expect.objectContaining({ packVersionId: starter.versionIds[0] }),
      ]);
      expect(await listFittingPublicPacks(db, ukTrip())).toEqual([]);
      expect(await findMatchingPublicPack(db, ukTrip())).toBeNull();
      // With only a starter list published, the case still says no reviewed checklist exists.
      expect(await explainNoFittingPack(db, ukTrip())).toEqual(['NO_REVIEWED_CHECKLIST']);
    });

    it('are not found when withdrawn, or when the key is not a starter key', async () => {
      await pack({
        key: 'starter.gb.tourist',
        jurisdiction: 'GB',
        purpose: 'tourism',
        authoritative: false,
        status: 'WITHDRAWN',
      });
      await pack({
        key: 'synthetic.unreviewed',
        jurisdiction: 'GB',
        purpose: 'tourism',
        authoritative: false,
      });
      expect(await listFittingStarterPacks(db, ukTrip())).toEqual([]);
    });
  });

  describe('route (UMPE P1, R05)', () => {
    it('leaves out a pack for another known route', async () => {
      await pack({ jurisdiction: 'UK', purpose: 'Tourism', route: 'Standard Visitor' });
      const trip = { ...ukTrip(), route: ['Transit Visitor'] };
      expect(await listFittingPublicPacks(db, trip)).toEqual([]);
      expect(await findMatchingPublicPack(db, trip)).toBeNull();
    });

    it('links a pack whose route matches the known route, whatever names it uses', async () => {
      const uk = await pack({ jurisdiction: 'UK', purpose: 'Tourism', route: 'Standard_Visitor' });
      expect(
        await findMatchingPublicPack(db, { ...ukTrip(), route: ['standard visitor'] }),
      ).toMatchObject({ packVersionId: uk.versionIds[0], coversRoute: true });
    });

    it('lists a route-specific pack when the route is unknown, and never links it', async () => {
      const uk = await pack({ jurisdiction: 'UK', purpose: 'Tourism', route: 'Standard Visitor' });
      for (const trip of [ukTrip(), { ...ukTrip(), route: [] }, { ...ukTrip(), route: [' '] }]) {
        expect(await findMatchingPublicPack(db, trip)).toBeNull();
        expect(await listFittingPublicPacks(db, trip)).toEqual([
          expect.objectContaining({ packVersionId: uk.versionIds[0], coversRoute: false }),
        ]);
      }
    });

    it('a pack with no route still links when the case route is known', async () => {
      const uk = await pack({ jurisdiction: 'UK', purpose: 'Tourism' });
      expect(
        await findMatchingPublicPack(db, { ...ukTrip(), route: ['Standard Visitor'] }),
      ).toMatchObject({ packVersionId: uk.versionIds[0], coversRoute: true });
    });
  });

  it('takes the newest published version of the matching pack', async () => {
    const uk = await pack({ jurisdiction: 'GB', purpose: 'tourism', versions: [1, 3, 2] });
    const match = await findMatchingPublicPack(db, ukTrip());
    expect(match?.packVersionId).toBe(uk.versionIds[1]);
    expect(match?.version).toBe(3);
  });

  it('links nothing when two different packs fit, so the person chooses', async () => {
    await pack({ jurisdiction: 'UK', purpose: 'tourism' });
    await pack({ jurisdiction: 'United Kingdom', purpose: 'Tourism' });
    expect(await findMatchingPublicPack(db, ukTrip())).toBeNull();
  });

  it('never links a draft, an agency pack or a pack with no coverage', async () => {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Synthetic Agency' })
      .returning();
    if (!org) throw new Error('org');
    await pack({ jurisdiction: 'UK', purpose: 'tourism', status: 'DRAFT' });
    await pack({ jurisdiction: 'UK', purpose: 'tourism', organizationId: org.id });
    await pack({ jurisdiction: 'UK', purpose: null });
    // A platform pack that was never reviewed as part of the public catalogue.
    await pack({ jurisdiction: 'UK', purpose: 'tourism', authoritative: false });
    await pack({ jurisdiction: null, purpose: 'tourism' });
    expect(await findMatchingPublicPack(db, ukTrip())).toBeNull();
  });

  it("never links an agency's own pack after the agency is deleted", async () => {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Synthetic Closing Agency' })
      .returning();
    if (!org) throw new Error('org');
    await pack({
      jurisdiction: 'UK',
      purpose: 'tourism',
      organizationId: org.id,
      authoritative: false,
    });
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org.id));
    const [orphan] = await db.select().from(schema.packs);
    expect(orphan?.ownerOrganizationId).toBeNull();
    expect(await findMatchingPublicPack(db, ukTrip())).toBeNull();
    expect(await listFittingPublicPacks(db, ukTrip())).toEqual([]);
  });

  it('needs both a country and a purpose', async () => {
    await pack({ jurisdiction: 'UK', purpose: 'tourism' });
    expect(await findMatchingPublicPack(db, { ...ukTrip(), purpose: [] })).toBeNull();
    expect(await findMatchingPublicPack(db, { ...ukTrip(), country: [] })).toBeNull();
    expect(await findMatchingPublicPack(db, { ...ukTrip(), country: [' '] })).toBeNull();
  });

  it('matches accented and punctuated labels in the database the same way as here', async () => {
    const ci = await pack({ jurisdiction: 'Côte d’Ivoire', purpose: 'Family or Friends Visit' });
    expect(
      await findMatchingPublicPack(db, {
        country: ['CI', "Cote d'Ivoire"],
        purpose: ['family_or_friends_visit'],
        traveller: UNKNOWN,
      }),
    ).toMatchObject({ packVersionId: ci.versionIds[0] });
  });

  it('lets accent marks of every kind through the database and decides with the exact key', async () => {
    // U+1DC4 (a combining mark from the supplement block) lies outside the common accent block.
    const marked = await pack({
      jurisdiction: `Ma${String.fromCodePoint(0x1dc4)}li`,
      purpose: 'Tourism',
    });
    await pack({ jurisdiction: 'Malin', purpose: 'Tourism' });
    expect(
      await findMatchingPublicPack(db, {
        country: ['ML', 'Mali'],
        purpose: TOURISM,
        traveller: UNKNOWN,
      }),
    ).toMatchObject({ packVersionId: marked.versionIds[0] });
  });

  it('reads only the newest published version of each matching pack', async () => {
    await pack({ jurisdiction: 'UK', purpose: 'tourism', versions: [1, 2] });
    await pack({ jurisdiction: 'Canada', purpose: 'tourism', versions: [1, 2, 3] });
    const fitting = await listFittingPublicPacks(db, ukTrip());
    expect(fitting.map((row) => row.version)).toEqual([2]);
  });

  describe('who the pack is for', () => {
    it('never links a pack meant for other nationalities', async () => {
      await pack({ jurisdiction: 'UK', purpose: 'tourism', nationality: ['IN'] });
      expect(await findMatchingPublicPack(db, ukTrip(BANGLADESHI))).toBeNull();
      expect(await listFittingPublicPacks(db, ukTrip(BANGLADESHI))).toEqual([]);
    });

    it('never links a restricted pack when the traveller is not known, but still counts it to pick', async () => {
      const bd = await pack({ jurisdiction: 'UK', purpose: 'tourism', nationality: ['BD'] });
      expect(await findMatchingPublicPack(db, ukTrip())).toBeNull();
      expect(await listFittingPublicPacks(db, ukTrip())).toEqual([
        expect.objectContaining({ packVersionId: bd.versionIds[0], coversTraveller: false }),
      ]);
    });

    it('counts a value that names no country as not known, never as someone else', async () => {
      await pack({ jurisdiction: 'UK', purpose: 'tourism', nationality: ['IN'] });
      // "Indian" was confirmed but names no country the app can read: the pack may be theirs.
      const unreadable = ukTrip({
        nationality: { terms: [], known: false },
        residence: NONE,
      });
      expect(await findMatchingPublicPack(db, unreadable)).toBeNull();
      expect(await listFittingPublicPacks(db, unreadable)).toEqual([
        expect.objectContaining({ coversTraveller: false }),
      ]);
    });

    it('links nothing while another pack may be meant for the traveller', async () => {
      await pack({ jurisdiction: 'UK', purpose: 'tourism' });
      await pack({ jurisdiction: 'UK', purpose: 'tourism', nationality: ['BD'] });
      expect(await findMatchingPublicPack(db, ukTrip())).toBeNull();
      expect((await listFittingPublicPacks(db, ukTrip())).map((p) => p.coversTraveller)).toEqual([
        true,
        false,
      ]);
    });

    it('links a pack that names the traveller, by code or name, and leaves out one for others', async () => {
      const bd = await pack({
        jurisdiction: 'UK',
        purpose: 'tourism',
        nationality: ['bangladesh'],
      });
      await pack({ jurisdiction: 'UK', purpose: 'tourism', nationality: ['IN', 'PK'] });
      expect(await findMatchingPublicPack(db, ukTrip(BANGLADESHI))).toMatchObject({
        packVersionId: bd.versionIds[0],
      });
    });

    it('checks residence the same way', async () => {
      await pack({ jurisdiction: 'UK', purpose: 'tourism', residence: ['AE'] });
      expect(await findMatchingPublicPack(db, ukTrip(BANGLADESHI))).toBeNull();
      expect(
        await findMatchingPublicPack(db, ukTrip({ nationality: BD, residence: NONE })),
      ).toBeNull();
      const living = ukTrip({ nationality: BD, residence: { terms: ['AE', 'UAE'], known: true } });
      expect(await findMatchingPublicPack(db, living)).not.toBeNull();
    });

    it('treats an empty list as not narrowing who the pack is for', async () => {
      const open = await pack({ jurisdiction: 'UK', purpose: 'tourism', nationality: [] });
      expect(await findMatchingPublicPack(db, ukTrip())).toMatchObject({
        packVersionId: open.versionIds[0],
      });
    });
  });

  describe('why no checklist fits (VS-006)', () => {
    async function declare(
      versionId: string,
      conditions: { consularPosts?: string[]; travelFrom?: string; travelUntil?: string },
    ) {
      await db.insert(schema.packRouteConditions).values({
        packVersionId: versionId,
        consularPosts: conditions.consularPosts ?? [],
        travelFrom: conditions.travelFrom ?? null,
        travelUntil: conditions.travelUntil ?? null,
      });
    }

    it('says there is no reviewed checklist when nothing reviewed is published for the route', async () => {
      // An unsupported route: only an unreviewed test pack, a draft and an agency pack exist.
      const org = await db
        .insert(schema.organizations)
        .values({ name: 'Agency', status: 'ACTIVE' })
        .returning();
      await pack({ jurisdiction: 'UK', purpose: 'Tourism', authoritative: false });
      await pack({ jurisdiction: 'UK', purpose: 'Tourism', status: 'DRAFT' });
      await pack({ jurisdiction: 'UK', purpose: 'Tourism', organizationId: org[0]?.id ?? '' });
      await pack({ jurisdiction: 'Canada', purpose: 'Tourism' });
      expect(await listFittingPublicPacks(db, ukTrip())).toEqual([]);
      expect(await explainNoFittingPack(db, ukTrip())).toEqual(['NO_REVIEWED_CHECKLIST']);
    });

    it('says so when the case names no destination or purpose to look up', async () => {
      expect(await explainNoFittingPack(db, { ...ukTrip(), country: [] })).toEqual([
        'NO_REVIEWED_CHECKLIST',
      ]);
    });

    it('explains nothing when a checklist fits, linked or not', async () => {
      await pack({ jurisdiction: 'UK', purpose: 'Tourism' });
      expect(await explainNoFittingPack(db, ukTrip())).toEqual([]);
      await pack({ jurisdiction: 'UK', purpose: 'Tourism', nationality: ['BD'] });
      expect(await explainNoFittingPack(db, ukTrip())).toEqual([]);
    });

    it('names who the existing checklist is meant for instead', async () => {
      await pack({ jurisdiction: 'UK', purpose: 'Tourism', nationality: ['IN'] });
      expect(await explainNoFittingPack(db, ukTrip(BANGLADESHI))).toEqual(['OTHER_NATIONALITY']);
      await pack({ jurisdiction: 'GB', purpose: 'Tourism', residence: ['AE'] });
      expect(await explainNoFittingPack(db, ukTrip(BANGLADESHI))).toEqual([
        'OTHER_NATIONALITY',
        'OTHER_RESIDENCE',
      ]);
    });

    it('names a different route', async () => {
      await pack({ jurisdiction: 'UK', purpose: 'Tourism', route: 'Standard Visitor' });
      expect(await explainNoFittingPack(db, { ...ukTrip(), route: ['Transit Visitor'] })).toEqual([
        'OTHER_ROUTE',
      ]);
    });

    it('names a different application post, and never reads the destination as the post', async () => {
      const dhaka = await pack({ jurisdiction: 'UK', purpose: 'Tourism' });
      await declare(dhaka.versionIds[0] ?? '', { consularPosts: ['Dhaka'] });
      // The case is for travel to the United Kingdom and applies in Sylhet: the destination is
      // not the application post, so only a post that really differs excludes the pack.
      expect(await explainNoFittingPack(db, { ...ukTrip(), consularPost: 'Sylhet' })).toEqual([
        'OTHER_APPLICATION_POST',
      ]);
      expect(await listFittingPublicPacks(db, { ...ukTrip(), consularPost: 'Sylhet' })).toEqual([]);
      // Putting the destination in the post slot is a mismatch too: it never matches a post.
      expect(
        await explainNoFittingPack(db, { ...ukTrip(), consularPost: 'United Kingdom' }),
      ).toEqual(['OTHER_APPLICATION_POST']);
      // A post that is not set is "not known", never a mismatch: the pack is listed, not linked.
      expect(await explainNoFittingPack(db, ukTrip())).toEqual([]);
      expect(await findMatchingPublicPack(db, ukTrip())).toBeNull();
      expect(await listFittingPublicPacks(db, ukTrip())).toEqual([
        expect.objectContaining({ needs: ['APPLICATION_POST'] }),
      ]);
      expect(
        await findMatchingPublicPack(db, { ...ukTrip(), consularPost: 'Dhaka' }),
      ).toMatchObject({
        packVersionId: dhaka.versionIds[0],
      });
    });

    it('names travel dates outside the window the checklist covers', async () => {
      const window = await pack({ jurisdiction: 'UK', purpose: 'Tourism' });
      await declare(window.versionIds[0] ?? '', {
        travelFrom: '2027-01-01',
        travelUntil: '2027-06-30',
      });
      expect(
        await explainNoFittingPack(db, {
          ...ukTrip(),
          travelStart: new Date('2026-12-01T00:00:00Z'),
        }),
      ).toEqual(['OUTSIDE_TRAVEL_DATES']);
    });

    it('gives the same answer as the matcher about what fits', async () => {
      const terms = ukTrip(BANGLADESHI);
      await pack({ jurisdiction: 'UK', purpose: 'Tourism', nationality: ['IN'] });
      const fitting = await listFittingPublicPacks(db, terms);
      expect(fitting).toEqual([]);
      expect((await explainNoFittingPack(db, terms)).length).toBeGreaterThan(0);
    });
  });

  describe('a synthetic reviewed checklist (VS-006)', () => {
    it('links once for a Bangladeshi traveller living in Bangladesh, and not when two fit', async () => {
      const synthetic = await pack({
        jurisdiction: 'UK',
        purpose: 'Tourism',
        nationality: ['Bangladesh'],
        residence: ['Bangladesh'],
      });
      expect(await findMatchingPublicPack(db, ukTrip(BANGLADESHI))).toEqual({
        packVersionId: synthetic.versionIds[0],
        packName: synthetic.name,
        version: 1,
        coversTraveller: true,
        coversRoute: true,
      });
      // A second reviewed checklist for the same route is ambiguity: nothing links, the person picks.
      await pack({ jurisdiction: 'United Kingdom', purpose: 'tourism' });
      expect(await findMatchingPublicPack(db, ukTrip(BANGLADESHI))).toBeNull();
      expect(await listFittingPublicPacks(db, ukTrip(BANGLADESHI))).toHaveLength(2);
      expect(await explainNoFittingPack(db, ukTrip(BANGLADESHI))).toEqual([]);
    });

    it('still links a reviewed checklist whose review date has passed (it is warned about, not hidden)', async () => {
      const overdue = await pack({ jurisdiction: 'UK', purpose: 'Tourism' });
      await db
        .update(schema.packVersions)
        .set({ nextReviewDate: new Date('2026-10-23T00:00:00Z') })
        .where(eq(schema.packVersions.id, overdue.versionIds[0] ?? ''));
      expect(await findMatchingPublicPack(db, ukTrip())).toMatchObject({
        packVersionId: overdue.versionIds[0],
      });
    });
  });
});

describe('readTravellerCoverage', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    for (const key of ['nationality', 'country_of_residence', 'given_name']) {
      await registerFieldDefinition(db, { key, dataType: 'string' });
    }
  });

  async function person(email: string) {
    const provisioned = await provisionAccount(db, { email });
    if (!isOk(provisioned)) throw new Error('provision failed');
    await setConsent(db, {
      actorAccountId: provisioned.value.id,
      accountId: provisioned.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: provisioned.value.id,
      ownerAccountId: provisioned.value.id,
      displayName: 'Synthetic Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant failed');
    return { accountId: provisioned.value.id, applicantId: applicant.value.id };
  }

  it('returns only the confirmed nationality and residence of the traveller the gate allowed', async () => {
    const me = await person('coverage-owner@synthetic.test');
    const other = await person('coverage-other@synthetic.test');
    const save = async (
      who: { accountId: string; applicantId: string },
      fieldKey: string,
      value: string,
      status?: 'EXTRACTED_PENDING',
    ) => {
      const saved = await editFact(db, {
        actorAccountId: who.accountId,
        applicantId: who.applicantId,
        fieldKey,
        value,
        ...(status ? { status } : {}),
      });
      if (!isOk(saved)) throw new Error(`save failed: ${JSON.stringify(saved.error)}`);
    };
    await save(me, 'nationality', ' Bangladeshi ');
    await save(me, 'country_of_residence', 'United Arab Emirates', 'EXTRACTED_PENDING');
    await save(me, 'given_name', 'Synthetic');
    await save(other, 'nationality', 'Indian');

    const proof = await requireAccess(
      db,
      accountPrincipal(me.accountId),
      'MANAGE',
      { applicantId: me.applicantId },
      { purpose: 'owner_checklist_match' },
    );
    if (!isOk(proof)) throw new Error('gate refused');
    expect(await readTravellerCoverage(proof.value)).toEqual({
      nationality: ['Bangladeshi'],
      residence: [],
    });
    // A copied object is not a proof.
    expect(await readTravellerCoverage({ ...proof.value } as typeof proof.value)).toEqual({
      nationality: [],
      residence: [],
    });
  });
});
