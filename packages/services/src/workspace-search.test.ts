import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { searchWorkspaceRecords } from './workspace-search';

const client = new PGlite();
const local = drizzle(client, { schema });
const db = local as unknown as Db;
const ids = Object.fromEntries(
  [
    'owner',
    'stranger',
    'staff',
    'org',
    'self',
    'family',
    'foreign',
    'case',
    'unassigned',
    'foreignCase',
    'document',
    'hidden',
    'grant',
  ].map((name, i) => [name, `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]),
);
function id(name: string): string {
  const value = ids[name];
  if (!value) throw new Error('Synthetic ID');
  return value;
}
beforeAll(async () => {
  await migrate(local, {
    migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
  });
  await db.insert(schema.accounts).values(
    ['owner', 'stranger', 'staff'].map((name) => ({
      id: id(name),
      email: `${name}@example.test`,
    })),
  );
  await db.insert(schema.applicants).values([
    { id: id('self'), ownerAccountId: id('owner'), displayName: 'Synthetic traveller' },
    { id: id('family'), ownerAccountId: id('owner'), displayName: 'Synthetic family' },
    { id: id('foreign'), ownerAccountId: id('stranger'), displayName: 'Synthetic foreign' },
  ]);
  await db.insert(schema.missions).values([
    { id: id('case'), applicantId: id('self'), title: 'Synthetic assigned case' },
    { id: id('unassigned'), applicantId: id('self'), title: 'Synthetic unassigned case' },
    { id: id('foreignCase'), applicantId: id('foreign'), title: 'Synthetic foreign case' },
  ]);
  await db.insert(schema.documents).values([
    { id: id('document'), applicantId: id('self'), originalName: 'Synthetic bank.pdf' },
    {
      id: id('hidden'),
      applicantId: id('self'),
      originalName: 'Synthetic case-only.pdf',
      walletVisible: false,
    },
    { applicantId: id('foreign'), originalName: 'Synthetic foreign.pdf' },
  ]);
  await db
    .insert(schema.organizations)
    .values({ id: id('org'), name: 'Synthetic agency', status: 'ACTIVE' });
  await db.insert(schema.memberships).values([
    { accountId: id('owner'), organizationId: id('org'), role: 'OWNER' },
    { accountId: id('staff'), organizationId: id('org'), role: 'CASE_MANAGER' },
  ]);
  await db.insert(schema.grants).values({
    id: id('grant'),
    applicantId: id('self'),
    recipientOrganizationId: id('org'),
    status: 'ACTIVE',
    acceptedAt: new Date(),
    actions: ['VIEW_METADATA'],
    purpose: 'Synthetic case access',
  });
  await db
    .insert(schema.assignments)
    .values({ organizationId: id('org'), memberAccountId: id('staff'), missionId: id('case') });
});
afterAll(async () => {
  await client.close();
});

describe('metadata search respects the existing context boundaries', () => {
  it('returns only owned metadata and excludes case-only wallet documents', async () => {
    const result = await searchWorkspaceRecords(db, id('owner'), { kind: 'personal' }, 'Synthetic');
    if (!result.ok) throw new Error('Search failed');
    expect(result.value.some((row) => row.label.includes('foreign'))).toBe(false);
    expect(result.value.some((row) => row.label.includes('case-only'))).toBe(false);
    expect(result.value.map((row) => row.category)).toEqual(
      expect.arrayContaining(['Profile', 'Case', 'Document']),
    );
  });
  it('does not leak another owned person into a selected-person search', async () => {
    const result = await searchWorkspaceRecords(
      db,
      id('owner'),
      { kind: 'personal', applicantId: id('family') },
      'Synthetic',
    );
    if (!result.ok) throw new Error('Search failed');
    expect(result.value.map((row) => row.label)).toEqual(['Synthetic family']);
    expect(
      (
        await searchWorkspaceRecords(
          db,
          id('stranger'),
          { kind: 'personal', applicantId: id('self') },
          'Synthetic',
        )
      ).ok,
    ).toBe(false);
  });
  it('treats wildcard input literally and rejects invalid query lengths', async () => {
    expect(await searchWorkspaceRecords(db, id('owner'), { kind: 'personal' }, '__')).toEqual({
      ok: true,
      value: [],
    });
    expect((await searchWorkspaceRecords(db, id('owner'), { kind: 'personal' }, 'x')).ok).toBe(
      false,
    );
    expect(
      (await searchWorkspaceRecords(db, id('owner'), { kind: 'personal' }, 'x'.repeat(81))).ok,
    ).toBe(false);
  });
  it('returns only assigned agency cases for a worker and current-grant cases for its owner', async () => {
    const scope = { kind: 'agency', organizationId: id('org') } as const;
    const worker = await searchWorkspaceRecords(db, id('staff'), scope, 'Synthetic');
    const owner = await searchWorkspaceRecords(db, id('owner'), scope, 'Synthetic');
    if (!worker.ok || !owner.ok) throw new Error('Agency search failed');
    expect(worker.value.filter((row) => row.category === 'Case').map((row) => row.id)).toEqual([
      id('case'),
    ]);
    expect(owner.value.filter((row) => row.category === 'Case').map((row) => row.id)).toEqual([
      id('case'),
      id('unassigned'),
    ]);
    expect((await searchWorkspaceRecords(db, id('stranger'), scope, 'Synthetic')).ok).toBe(false);
  });
  it('stops exposing metadata when the existing grant is revoked', async () => {
    await db
      .update(schema.grants)
      .set({ status: 'REVOKED' })
      .where(eq(schema.grants.id, id('grant')));
    expect(
      await searchWorkspaceRecords(
        db,
        id('staff'),
        { kind: 'agency', organizationId: id('org') },
        'Synthetic',
      ),
    ).toEqual({ ok: true, value: [] });
  });
  it('enforces a per-category bound instead of loading the entire wallet', async () => {
    await db.insert(schema.documents).values(
      Array.from({ length: 20 }, (_, i) => ({
        applicantId: id('self'),
        originalName: `Synthetic extra ${i}.pdf`,
      })),
    );
    const result = await searchWorkspaceRecords(db, id('owner'), { kind: 'personal' }, 'Synthetic');
    if (!result.ok) throw new Error('Search failed');
    expect(result.value.filter((row) => row.category === 'Document')).toHaveLength(6);
    expect(result.value.length).toBeLessThanOrEqual(18);
  });
});
