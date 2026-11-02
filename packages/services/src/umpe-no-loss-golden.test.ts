/**
 * UMPE P0 no-loss golden tests (docs/umpe, interface freeze ADR 0026).
 *
 * These pin behaviour that every later UMPE change must keep:
 * 1. The published pack manifest serialization and its sha256 checksum are
 *    byte-for-byte frozen. Every pack version approved before the UMPE rule
 *    upgrade must keep verifying (`verifyPackChecksum` recomputes from the
 *    stored rows, so any new key emitted for an old row breaks it).
 * 2. Fields deliberately outside the checksum (notes, freshness, condition,
 *    source evidence) stay outside it.
 * 3. Tampering with a checksummed field is still detected.
 * 4. A rule condition over an unknown fact evaluates to 'unknown', never to
 *    'true' or 'false' (unknown is "needs verification", not "not applicable").
 *
 * If a test here fails, the change under test is breaking historic truth.
 * Do not update the golden values; add a new, versioned serializer instead.
 */
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  type PackRequirement,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  buildManifest,
  createPack,
  listRequirements,
  verifyPackChecksum,
} from './packs';
import { evaluateCondition } from './rule-conditions';

/** Synthetic rows: mixed kinds, optional flags, null keys, case and a non-ASCII citation. */
const GOLDEN_ROWS = [
  {
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'bank_statement',
    citation: 'Appendix V 4.2 (b)',
    optional: false,
  },
  {
    kind: 'FIELD',
    fieldKey: 'passport.number',
    docType: null,
    citation: 'Appendix V 4.2',
    optional: false,
  },
  {
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'Employer_Letter',
    citation: 'Guidance p.7',
    optional: true,
  },
  {
    kind: 'FIELD',
    fieldKey: 'travel.purpose',
    docType: null,
    citation: 'Annexe É section 3',
    optional: false,
  },
  {
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'hotel_booking',
    citation: 'Guidance p.7',
    optional: true,
  },
] as const;

const GOLDEN_MANIFEST_JSON =
  '{"requirements":[' +
  '{"kind":"DOCUMENT","fieldKey":null,"docType":"bank_statement","citation":"Appendix V 4.2 (b)","optional":false},' +
  '{"kind":"DOCUMENT","fieldKey":null,"docType":"Employer_Letter","citation":"Guidance p.7","optional":true},' +
  '{"kind":"DOCUMENT","fieldKey":null,"docType":"hotel_booking","citation":"Guidance p.7","optional":true},' +
  '{"kind":"FIELD","fieldKey":"passport.number","docType":null,"citation":"Appendix V 4.2","optional":false},' +
  '{"kind":"FIELD","fieldKey":"travel.purpose","docType":null,"citation":"Annexe É section 3","optional":false}' +
  ']}';

const GOLDEN_CHECKSUM = 'daf22ce5899e97e765cfa7a432e7ddd021e66a67c756c673d06677f281e05045';

function asRows(extra: Partial<PackRequirement> = {}): PackRequirement[] {
  return GOLDEN_ROWS.map((r) => ({ ...r, ...extra }) as unknown as PackRequirement);
}

describe('UMPE P0: frozen pack manifest serialization', () => {
  it('serializes the golden rows to the exact frozen bytes and checksum', () => {
    const { manifest, checksum } = buildManifest(asRows());
    expect(JSON.stringify(manifest)).toBe(GOLDEN_MANIFEST_JSON);
    expect(checksum).toBe(GOLDEN_CHECKSUM);
  });

  it('does not depend on input row order', () => {
    const reversed = [...asRows()].reverse();
    expect(buildManifest(reversed).checksum).toBe(GOLDEN_CHECKSUM);
  });

  it('keeps notes, freshness, condition and source evidence outside the checksum', () => {
    const decorated = asRows({
      notes: 'internal note',
      maxAgeDays: 90,
      condition: { op: 'exists', field: 'sponsor.name' },
      sourceUrl: 'https://example.gov/page',
      sourceTitle: 'Official page',
      publisher: 'Example Authority',
      officialExtract: 'copied words',
      interpretation: 'plain reading',
      observedDate: new Date('2026-01-01T00:00:00Z'),
    } as unknown as Partial<PackRequirement>);
    expect(buildManifest(decorated).checksum).toBe(GOLDEN_CHECKSUM);
  });
});

describe('UMPE P0: approved pack versions keep verifying', () => {
  let db: Db;
  let versionId: string;

  beforeAll(async () => {
    const client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    const account = await provisionAccount(db, { email: 'golden-author@example.com' });
    if (!isOk(account)) throw new Error('provision');
    const actorAccountId = account.value.id;
    const pack = await createPack(db, { actorAccountId, key: 'umpe.golden', name: 'UMPE Golden' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    versionId = version.value.id;
    for (const row of GOLDEN_ROWS) {
      const added = await addRequirement(db, {
        actorAccountId,
        packVersionId: versionId,
        kind: row.kind,
        ...(row.fieldKey ? { fieldKey: row.fieldKey } : {}),
        ...(row.docType ? { docType: row.docType } : {}),
        citation: row.citation,
        optional: row.optional,
      });
      if (!isOk(added)) throw new Error(`requirement ${row.citation}`);
    }
    const approved = await approvePackVersion(db, { actorAccountId, packVersionId: versionId });
    if (!isOk(approved)) throw new Error('approve');
  }, 60_000);

  it('stores exactly the golden checksum at approval', async () => {
    const [stored] = await db
      .select({ checksum: schema.packVersions.checksum, manifest: schema.packVersions.manifest })
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, versionId));
    expect(stored?.checksum).toBe(GOLDEN_CHECKSUM);
    // Postgres jsonb normalises key order, so the stored manifest is equal in
    // content but NOT byte-identical to the checksummed serialization. A
    // verifier must therefore never hash the stored jsonb text; it recomputes
    // from rows (verifyPackChecksum) or canonicalises first.
    expect(stored?.manifest).toEqual(JSON.parse(GOLDEN_MANIFEST_JSON));
    expect(JSON.stringify(stored?.manifest)).not.toBe(GOLDEN_MANIFEST_JSON);
    expect(await verifyPackChecksum(db, versionId)).toBe(true);
  });

  it('still verifies after fields outside the checksum change on stored rows', async () => {
    const rows = await listRequirements(db, versionId);
    const target = rows[0];
    if (!target) throw new Error('rows');
    await db
      .update(schema.packRequirements)
      .set({ notes: 'edited note', maxAgeDays: 30 })
      .where(eq(schema.packRequirements.id, target.id));
    expect(await verifyPackChecksum(db, versionId)).toBe(true);
  });

  it('detects tampering with a checksummed field', async () => {
    const rows = await listRequirements(db, versionId);
    const target = rows.find((r) => r.optional === false);
    if (!target) throw new Error('rows');
    await db
      .update(schema.packRequirements)
      .set({ optional: true })
      .where(eq(schema.packRequirements.id, target.id));
    expect(await verifyPackChecksum(db, versionId)).toBe(false);
    await db
      .update(schema.packRequirements)
      .set({ optional: false })
      .where(eq(schema.packRequirements.id, target.id));
    expect(await verifyPackChecksum(db, versionId)).toBe(true);
  });
});

describe('UMPE P0: unknown facts stay unknown', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  const empty = { now, getValue: () => undefined };

  it.each([
    [{ op: 'exists', field: 'sponsor.name' }],
    [{ op: 'equals', field: 'applicant.nationality', value: 'BD' }],
    [{ op: 'notEquals', field: 'applicant.nationality', value: 'BD' }],
    [{ op: 'memberOf', field: 'applicant.residence', values: ['BD', 'SG'] }],
  ] as const)('%j over a missing fact is unknown', (condition) => {
    expect(evaluateCondition(condition, empty)).toBe('unknown');
  });

  it('an AND with one unknown and no false member is unknown, not true', () => {
    const ctx = { now, getValue: (f: string) => (f === 'a' ? 'x' : undefined) };
    expect(
      evaluateCondition(
        {
          op: 'and',
          conditions: [
            { op: 'equals', field: 'a', value: 'x' },
            { op: 'exists', field: 'b' },
          ],
        },
        ctx,
      ),
    ).toBe('unknown');
  });
});
