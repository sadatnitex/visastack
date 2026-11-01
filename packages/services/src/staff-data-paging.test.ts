import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { listActiveLegalHolds } from './legal-hold';
import { listAllOrganizations } from './organizations';
import { encodeTimeCursor } from './paging';
import { APPLICANT_LOOKUP_MAX, APPLICANT_SEARCH_MAX, listAllApplicants } from './platform-reads';
import { seedStaffAccount, staffScopeFor } from './platform-roles.test-support';

/**
 * WP-SB7 (Scroll Budget, staff data and settings): the organizations list, the active legal holds
 * and the privacy picker's applicant search read in bounded pages. Each read keeps its role check,
 * a cursor from another list or filter gives the first page, and nothing is lost between pages.
 */

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

const BASE = Date.UTC(2026, 9, 1, 9, 0, 0);

describe('listAllOrganizations with options', () => {
  let db: Db;
  beforeAll(async () => {
    db = await freshDb();
    // 60 organizations, one second apart, every third one pending; two share a timestamp so the
    // id breaks the tie.
    const rows = Array.from({ length: 60 }, (_, index) => ({
      name: index === 7 ? 'Rapid 100%_Visas' : `Agency ${String(index).padStart(2, '0')}`,
      status: index % 3 === 0 ? ('PENDING_VERIFICATION' as const) : ('ACTIVE' as const),
      createdAt: new Date(BASE + (index === 59 ? 58 : index) * 1000),
    }));
    await db.insert(schema.organizations).values(rows);
  });

  it('keeps the full newest-first list when called without options', async () => {
    const all = await listAllOrganizations(db);
    expect(all).toHaveLength(60);
    expect(all[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(all[59]?.createdAt.getTime() ?? 0);
  });

  it('pages 25 at a time, newest first, with no row lost or repeated', async () => {
    const seen: string[] = [];
    let before: string | undefined;
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listAllOrganizations(db, { limit: 25, ...(before ? { before } : {}) });
      sizes.push(page.items.length);
      seen.push(...page.items.map((org) => org.id));
      if (!page.nextCursor) break;
      before = page.nextCursor;
    }
    expect(sizes).toEqual([25, 25, 10]);
    expect(new Set(seen).size).toBe(60);
    const all = await listAllOrganizations(db);
    expect(new Set(all.map((org) => org.id))).toEqual(new Set(seen));
  });

  it('narrows by status and by name, treating % and _ as plain text', async () => {
    const pending = await listAllOrganizations(db, { limit: 100, status: 'PENDING_VERIFICATION' });
    expect(pending.items).toHaveLength(20);
    expect(pending.items.every((org) => org.status === 'PENDING_VERIFICATION')).toBe(true);
    const literal = await listAllOrganizations(db, { search: '100%_' });
    expect(literal.items.map((org) => org.name)).toEqual(['Rapid 100%_Visas']);
    const wildcard = await listAllOrganizations(db, { search: '%' });
    expect(wildcard.items.map((org) => org.name)).toEqual(['Rapid 100%_Visas']);
    const anyCase = await listAllOrganizations(db, { search: '  agency 1' });
    expect(anyCase.items).toHaveLength(10);
  });

  it('gives the first page for a cursor made for another filter, a foreign list or nonsense', async () => {
    const first = await listAllOrganizations(db, { limit: 5 });
    const pendingPage = await listAllOrganizations(db, {
      limit: 5,
      status: 'PENDING_VERIFICATION',
    });
    const fromOtherFilter = await listAllOrganizations(db, {
      limit: 5,
      before: pendingPage.nextCursor ?? '',
    });
    expect(fromOtherFilter.items.map((org) => org.id)).toEqual(first.items.map((org) => org.id));
    const foreign = encodeTimeCursor(
      { at: '2026-10-01T09:00:30.000000Z', id: '5b1f7c56-3d0e-4d36-a3a1-7b8f0c2d9e10' },
      'platform:legal-holds:active',
    );
    for (const before of [foreign, 'not-a-cursor', '%%%', 'x'.repeat(600)]) {
      const page = await listAllOrganizations(db, { limit: 5, before });
      expect(page.items.map((org) => org.id)).toEqual(first.items.map((org) => org.id));
    }
  });

  it('never returns more than 100 rows, whatever the caller asks', async () => {
    const page = await listAllOrganizations(db, { limit: 10_000 });
    expect(page.items.length).toBeLessThanOrEqual(100);
  });
});

describe('listActiveLegalHolds with a page', () => {
  it('pages active holds only, newest first, without losing any', async () => {
    const db = await freshDb();
    const owner = await provisionAccount(db, { email: 'holder@example.com' });
    if (!isOk(owner)) throw new Error('provision');
    const [applicant] = await db
      .insert(schema.applicants)
      .values({ ownerAccountId: owner.value.id, displayName: 'Held Traveller' })
      .returning();
    if (!applicant) throw new Error('applicant');
    await db.insert(schema.legalHolds).values(
      Array.from({ length: 30 }, (_, index) => ({
        applicantId: applicant.id,
        reason: `Hold ${index}`,
        active: index % 5 !== 0,
        createdAt: new Date(BASE + index * 1000),
      })),
    );
    const first = await listActiveLegalHolds(db, { limit: 10 });
    expect(first.items.map((hold) => hold.reason).slice(0, 2)).toEqual(['Hold 29', 'Hold 28']);
    const second = await listActiveLegalHolds(db, { limit: 10, before: first.nextCursor ?? '' });
    const third = await listActiveLegalHolds(db, { limit: 10, before: second.nextCursor ?? '' });
    expect(third.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items, ...third.items].map((hold) => hold.id);
    expect(new Set(ids).size).toBe(24);
    expect([...first.items, ...second.items, ...third.items].every((hold) => hold.active)).toBe(
      true,
    );
    const legacy = await listActiveLegalHolds(db);
    expect(legacy).toHaveLength(24);
    const nonsense = await listActiveLegalHolds(db, { limit: 10, before: 'nonsense' });
    expect(nonsense.items.map((hold) => hold.id)).toEqual(first.items.map((hold) => hold.id));
  });
});

describe('listAllApplicants with a query (the privacy picker)', () => {
  let db: Db;
  let ids: string[];
  beforeAll(async () => {
    db = await freshDb();
    const owner = await provisionAccount(db, { email: 'family@example.com' });
    if (!isOk(owner)) throw new Error('provision');
    const rows = await db
      .insert(schema.applicants)
      .values(
        Array.from({ length: 45 }, (_, index) => ({
          ownerAccountId: owner.value.id,
          displayName:
            index === 3 ? 'Nadia 50%_Rahman' : `Traveller ${String(index).padStart(2, '0')}`,
        })),
      )
      .returning();
    ids = rows.map((row) => row.id);
  });

  it('returns at most 20 matches, by name, with only the id and the name', async () => {
    const admin = await seedStaffAccount(db, 'COMPLIANCE_ADMIN', 'compliance@example.com');
    const scope = await staffScopeFor(db, admin, 'APPLICANT_DIRECTORY_VIEW');
    const found = await listAllApplicants(db, scope, { search: 'traveller' });
    if (!isOk(found)) throw new Error('expected matches');
    expect(found.value).toHaveLength(APPLICANT_SEARCH_MAX);
    expect(found.value[0]).toEqual({ id: expect.any(String), displayName: 'Traveller 00' });
    expect(Object.keys(found.value[0] ?? {}).sort()).toEqual(['displayName', 'id']);
    const literal = await listAllApplicants(db, scope, { search: '50%_' });
    if (!isOk(literal)) throw new Error('expected a match');
    expect(literal.value.map((entry) => entry.displayName)).toEqual(['Nadia 50%_Rahman']);
    const tooShort = await listAllApplicants(db, scope, { search: ' t ' });
    expect(isOk(tooShort) && tooShort.value).toEqual([]);
    const byId = await listAllApplicants(db, scope, { search: (ids[3] ?? '').toUpperCase() });
    if (!isOk(byId)) throw new Error('expected a match');
    expect(byId.value.map((entry) => entry.id)).toEqual([ids[3]]);
  });

  it('resolves names only for real ids, bounded', async () => {
    const admin = await seedStaffAccount(db, 'COMPLIANCE_ADMIN', 'lookup@example.com');
    const scope = await staffScopeFor(db, admin, 'APPLICANT_DIRECTORY_VIEW');
    const wanted = [ids[0] ?? '', ids[1] ?? '', ids[0] ?? '', "x' or 1=1 --", ''];
    const named = await listAllApplicants(db, scope, { ids: wanted });
    if (!isOk(named)) throw new Error('expected names');
    expect(named.value.map((entry) => entry.id).sort()).toEqual([ids[0], ids[1]].sort());
    const many = Array.from(
      { length: APPLICANT_LOOKUP_MAX + 50 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const bounded = await listAllApplicants(db, scope, { ids: [...many, ids[2] ?? ''] });
    // The real id sits past the bound, so it is not looked up.
    expect(isOk(bounded) && bounded.value).toEqual([]);
  });

  it('refuses every role without the applicant directory, for search and lookup alike', async () => {
    const security = await seedStaffAccount(db, 'SECURITY_ADMIN', 'security@example.com');
    const scope = await staffPrincipal(db, security, 'AUDIT_TRAIL_VIEW');
    if (!scope.ok) throw new Error('expected an audit scope');
    // A scope for a different action must never open the directory, even when forced through.
    const forced = scope.value as unknown as Parameters<typeof listAllApplicants>[1];
    expect(isOk(await listAllApplicants(db, forced, { search: 'traveller' }))).toBe(false);
    expect(isOk(await listAllApplicants(db, forced, { ids: [ids[0] ?? ''] }))).toBe(false);
  });
});
