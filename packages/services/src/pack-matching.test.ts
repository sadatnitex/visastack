import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { findMatchingPublicPack, packMatchKey } from './pack-matching';

const UK = ['GB', 'United Kingdom', 'UK', 'Britain'];
const TOURISM = ['tourism', 'Tourism'];

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
    expect(await findMatchingPublicPack(db, { country: UK, purpose: TOURISM })).toEqual({
      packVersionId: uk.versionIds[0],
      packName: uk.name,
      version: 1,
    });
  });

  it('takes the newest published version of the matching pack', async () => {
    const uk = await pack({ jurisdiction: 'GB', purpose: 'tourism', versions: [1, 3, 2] });
    const match = await findMatchingPublicPack(db, { country: UK, purpose: TOURISM });
    expect(match?.packVersionId).toBe(uk.versionIds[1]);
    expect(match?.version).toBe(3);
  });

  it('links nothing when two different packs fit, so the person chooses', async () => {
    await pack({ jurisdiction: 'UK', purpose: 'tourism' });
    await pack({ jurisdiction: 'United Kingdom', purpose: 'Tourism' });
    expect(await findMatchingPublicPack(db, { country: UK, purpose: TOURISM })).toBeNull();
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
    expect(await findMatchingPublicPack(db, { country: UK, purpose: TOURISM })).toBeNull();
  });

  it('needs both a country and a purpose', async () => {
    await pack({ jurisdiction: 'UK', purpose: 'tourism' });
    expect(await findMatchingPublicPack(db, { country: UK, purpose: [] })).toBeNull();
    expect(await findMatchingPublicPack(db, { country: [], purpose: TOURISM })).toBeNull();
    expect(await findMatchingPublicPack(db, { country: [' '], purpose: TOURISM })).toBeNull();
  });
});
