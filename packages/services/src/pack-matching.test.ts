import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  type TravellerMatchTerms,
  findMatchingPublicPack,
  listFittingPublicPacks,
  packMatchKey,
  readTravellerCoverage,
} from './pack-matching';
import { editFact, registerFieldDefinition } from './profile';

const UK = ['GB', 'United Kingdom', 'UK', 'Britain'];
const TOURISM = ['tourism', 'Tourism'];
const UNKNOWN: TravellerMatchTerms = { nationality: [], residence: [] };
const BANGLADESHI: TravellerMatchTerms = {
  nationality: ['Bangladeshi', 'BD', 'Bangladesh'],
  residence: ['BD', 'Bangladesh'],
};
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
  }) {
    n += 1;
    const [row] = await db
      .insert(schema.packs)
      .values({
        key: `synthetic.pack.${n}`,
        name: `Synthetic Pack ${n}`,
        jurisdiction: input.jurisdiction,
        purpose: input.purpose,
        ownerOrganizationId: input.organizationId ?? null,
        nationalityApplicability: input.nationality ? [...input.nationality] : null,
        residenceApplicability: input.residence ? [...input.residence] : null,
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
    await pack({ jurisdiction: null, purpose: 'tourism' });
    expect(await findMatchingPublicPack(db, ukTrip())).toBeNull();
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

  it('reads only the newest published version of each matching pack', async () => {
    await pack({ jurisdiction: 'UK', purpose: 'tourism', versions: [1, 2] });
    await pack({ jurisdiction: 'Canada', purpose: 'tourism', versions: [1, 2, 3] });
    const fitting = await listFittingPublicPacks(db, ukTrip(), 'possible');
    expect(fitting.map((row) => row.version)).toEqual([2]);
  });

  describe('who the pack is for', () => {
    it('never links a pack meant for other nationalities', async () => {
      await pack({ jurisdiction: 'UK', purpose: 'tourism', nationality: ['IN'] });
      expect(await findMatchingPublicPack(db, ukTrip(BANGLADESHI))).toBeNull();
      expect(await listFittingPublicPacks(db, ukTrip(BANGLADESHI), 'possible')).toEqual([]);
    });

    it('never links a restricted pack when the traveller is not known, but still counts it to pick', async () => {
      const bd = await pack({ jurisdiction: 'UK', purpose: 'tourism', nationality: ['BD'] });
      expect(await findMatchingPublicPack(db, ukTrip())).toBeNull();
      expect(await listFittingPublicPacks(db, ukTrip(), 'possible')).toEqual([
        expect.objectContaining({ packVersionId: bd.versionIds[0] }),
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
        await findMatchingPublicPack(
          db,
          ukTrip({ nationality: BANGLADESHI.nationality, residence: [] }),
        ),
      ).toBeNull();
      const living = ukTrip({ nationality: BANGLADESHI.nationality, residence: ['AE', 'UAE'] });
      expect(await findMatchingPublicPack(db, living)).not.toBeNull();
    });

    it('treats an empty list as not narrowing who the pack is for', async () => {
      const open = await pack({ jurisdiction: 'UK', purpose: 'tourism', nationality: [] });
      expect(await findMatchingPublicPack(db, ukTrip())).toMatchObject({
        packVersionId: open.versionIds[0],
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
