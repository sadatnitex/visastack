import {
  formatReferenceCode,
  generateReferenceCode,
  referenceCheckCharacter,
} from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { assignReferenceCode } from './reference-codes';
import { searchWorkspaceRecords } from './workspace-search';

const client = await createMigratedPglite();
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

describe('looking a record up by its visible reference code (ADR 0018)', () => {
  const personal = { kind: 'personal' } as const;
  const agency = { kind: 'agency', organizationId: id('org') } as const;
  const codes = new Map<string, string>();
  let requestId = '';
  const code = async (kind: 'P' | 'C' | 'D' | 'R', name: string, entityId: string) => {
    const stored = await assignReferenceCode(db, kind, entityId);
    if (!stored) throw new Error('registry missing');
    codes.set(name, formatReferenceCode(kind, stored));
  };
  const found = async (
    accountId: string,
    scope: typeof personal | typeof agency,
    query: string,
  ) => {
    const result = await searchWorkspaceRecords(db, accountId, scope, query);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };

  beforeAll(async () => {
    // Earlier tests revoke the agency's grant; this block needs it live again.
    await db
      .update(schema.grants)
      .set({ status: 'ACTIVE' })
      .where(eq(schema.grants.id, id('grant')));
    const [request] = await db
      .insert(schema.evidenceRequests)
      .values({
        organizationId: id('org'),
        applicantId: id('self'),
        missionId: id('case'),
        kind: 'DOCUMENT',
        docType: 'BANK_STATEMENT',
      })
      .returning({ id: schema.evidenceRequests.id });
    requestId = request?.id ?? '';
    await code('P', 'self', id('self'));
    await code('C', 'case', id('case'));
    await code('C', 'unassigned', id('unassigned'));
    await code('C', 'foreignCase', id('foreignCase'));
    await code('D', 'document', id('document'));
    await code('D', 'hidden', id('hidden'));
    await code('R', 'request', requestId);
  });

  it("finds the owner's own person, case, document and request by code, in any typed form", async () => {
    expect(await found(id('owner'), personal, codes.get('self') ?? '')).toEqual([
      expect.objectContaining({
        category: 'Profile',
        id: id('self'),
        href: `/app/applicant/${id('self')}/profile`,
      }),
    ]);
    const typed = (codes.get('case') ?? '').toLowerCase().replace('-', ' ');
    expect(await found(id('owner'), personal, typed)).toEqual([
      expect.objectContaining({
        category: 'Case',
        id: id('case'),
        href: `/app/mission/${id('case')}`,
      }),
    ]);
    expect((await found(id('owner'), personal, codes.get('document') ?? ''))[0]?.label).toContain(
      codes.get('document'),
    );
    expect(await found(id('owner'), personal, codes.get('request') ?? '')).toEqual([
      expect.objectContaining({
        category: 'Request',
        href: `/app/applicant/${id('self')}/evidence#request-${requestId}`,
      }),
    ]);
  });

  it('answers an unknown code, a missing record and a record the person may not see the same way', async () => {
    const unknown = `C-${generateReferenceCode('C')}`;
    // A valid code whose record no longer exists.
    const gone = '10000000-0000-4000-8000-999999999999';
    await assignReferenceCode(db, 'C', gone);
    const [goneRow] = await db
      .select({ code: schema.referenceCodes.code })
      .from(schema.referenceCodes)
      .where(eq(schema.referenceCodes.entityId, gone));
    for (const query of [
      unknown,
      `C-${goneRow?.code}`,
      codes.get('foreignCase') ?? '',
      codes.get('hidden') ?? '',
    ]) {
      expect(await found(id('owner'), personal, query)).toEqual([]);
    }
    // A stranger gets nothing for the owner's records.
    for (const name of ['self', 'case', 'document', 'request']) {
      expect(await found(id('stranger'), personal, codes.get(name) ?? '')).toEqual([]);
    }
  });

  it('keeps an agency to its visible cases, and requests to its administrators', async () => {
    // The worker is assigned to "case" only.
    expect((await found(id('staff'), agency, codes.get('case') ?? '')).map((r) => r.id)).toEqual([
      id('case'),
    ]);
    expect(await found(id('staff'), agency, codes.get('unassigned') ?? '')).toEqual([]);
    expect(await found(id('staff'), agency, codes.get('foreignCase') ?? '')).toEqual([]);
    // A person opens at a case the agency may see, never at their profile.
    expect(await found(id('staff'), agency, codes.get('self') ?? '')).toEqual([
      expect.objectContaining({
        category: 'Client',
        href: `/app/agency/${id('org')}/cases#mission-${id('case')}`,
      }),
    ]);
    // Requests are managed by administrators.
    expect(await found(id('staff'), agency, codes.get('request') ?? '')).toEqual([]);
    expect(await found(id('owner'), agency, codes.get('request') ?? '')).toEqual([
      expect.objectContaining({
        category: 'Request',
        href: `/app/agency/${id('org')}/clients#request-${requestId}`,
      }),
    ]);
    // Another organization's request on the same traveller is never found.
    const otherOrg = '10000000-0000-4000-8000-000000000099';
    await db
      .insert(schema.organizations)
      .values({ id: otherOrg, name: 'Other agency', status: 'ACTIVE' });
    const [foreignRequest] = await db
      .insert(schema.evidenceRequests)
      .values({
        organizationId: otherOrg,
        applicantId: id('self'),
        missionId: id('case'),
        kind: 'DOCUMENT',
      })
      .returning({ id: schema.evidenceRequests.id });
    await code('R', 'foreignRequest', foreignRequest?.id ?? '');
    expect(await found(id('owner'), agency, codes.get('foreignRequest') ?? '')).toEqual([]);
    // Documents are not looked up by code in an agency workspace.
    expect(await found(id('owner'), agency, codes.get('document') ?? '')).toEqual([]);
    // With the sharing ended, nothing is found by code either.
    await db
      .update(schema.grants)
      .set({ status: 'REVOKED' })
      .where(eq(schema.grants.id, id('grant')));
    for (const name of ['case', 'self', 'request']) {
      expect(await found(id('owner'), agency, codes.get(name) ?? '')).toEqual([]);
    }
    await db
      .update(schema.grants)
      .set({ status: 'ACTIVE' })
      .where(eq(schema.grants.id, id('grant')));
  });

  it('still finds words that happen to read as a valid code, and puts a code hit first', async () => {
    // "Germany" reads as R-GERMANY and "Invoice" as D-1NV01CE: both pass the check by chance.
    await db.insert(schema.missions).values({ applicantId: id('self'), title: 'Germany' });
    await db.insert(schema.documents).values({ applicantId: id('self'), originalName: 'Invoice' });
    expect((await found(id('owner'), personal, 'Germany')).map((r) => r.label)).toEqual([
      'Germany',
    ]);
    expect((await found(id('owner'), personal, 'Invoice')).map((r) => r.label)).toEqual([
      'Invoice',
    ]);
    expect((await found(id('owner'), agency, 'Germany')).map((r) => r.label)).toContain('Germany');
    // A real code: its record first, then any text matches, each once.
    const results = await found(id('owner'), personal, codes.get('case') ?? '');
    expect(results[0]?.id).toBe(id('case'));
    expect(new Set(results.map((r) => `${r.category}:${r.id}`)).size).toBe(results.length);
  });

  it('does not look a mistyped code up', async () => {
    const stored = codes.get('case')?.slice(2) ?? '';
    const typo = `C-${stored.slice(0, 5)}${stored[5] === '0' ? '1' : '0'}`;
    expect(referenceCheckCharacter('C', stored.slice(0, 5))).toBe(stored[5]);
    expect(await found(id('owner'), personal, typo)).toEqual([]);
  });
});

describe('search and the resource lifecycle (LC-A2)', () => {
  it('never finds a Recently Deleted or archived document, by words or by reference', async () => {
    const [deleted, archived] = await db
      .insert(schema.documents)
      .values([
        { applicantId: id('self'), originalName: 'Synthetic removed copy.pdf' },
        { applicantId: id('self'), originalName: 'Synthetic shelved copy.pdf' },
      ])
      .returning({ id: schema.documents.id });
    if (!deleted || !archived) throw new Error('Synthetic documents');
    const now = new Date();
    await db.insert(schema.documentLifecycle).values([
      {
        documentId: deleted.id,
        applicantId: id('self'),
        deletedAt: now,
        deletePath: 'DUPLICATE',
        purgeAfter: new Date(now.getTime() + 30 * 86_400_000),
      },
      { documentId: archived.id, applicantId: id('self'), archivedAt: now },
    ]);
    const byWords = await searchWorkspaceRecords(db, id('owner'), { kind: 'personal' }, 'copy');
    if (!byWords.ok) throw new Error('Search failed');
    expect(byWords.value).toEqual([]);
    const stored = await assignReferenceCode(db, 'D', deleted.id);
    if (!stored) throw new Error('registry missing');
    const byCode = await searchWorkspaceRecords(
      db,
      id('owner'),
      { kind: 'personal' },
      formatReferenceCode('D', stored),
    );
    if (!byCode.ok) throw new Error('Search failed');
    expect(byCode.value).toEqual([]);
    await db
      .delete(schema.documentLifecycle)
      .where(eq(schema.documentLifecycle.applicantId, id('self')));
    await db.delete(schema.documents).where(eq(schema.documents.id, deleted.id));
    await db.delete(schema.documents).where(eq(schema.documents.id, archived.id));
  });

  it('leaves an archived traveller out of a search across travellers, and keeps it when opened', async () => {
    await db
      .insert(schema.applicantLifecycle)
      .values({ applicantId: id('family'), archivedAt: new Date() });
    const across = await searchWorkspaceRecords(db, id('owner'), { kind: 'personal' }, 'family');
    if (!across.ok) throw new Error('Search failed');
    expect(across.value).toEqual([]);
    const opened = await searchWorkspaceRecords(
      db,
      id('owner'),
      { kind: 'personal', applicantId: id('family') },
      'family',
    );
    if (!opened.ok) throw new Error('Search failed');
    expect(opened.value.map((row) => row.id)).toEqual([id('family')]);
    await db
      .delete(schema.applicantLifecycle)
      .where(eq(schema.applicantLifecycle.applicantId, id('family')));
  });
});
