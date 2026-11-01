import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { listPlatformMembers } from './platform-directory';
import { grantPlatformRole, revokePlatformRole } from './platform-roles';

const client = await createMigratedPglite();
const embeddedDb = drizzle(client, { schema });
const db = embeddedDb as unknown as Db;
let owner: { accountId: string; email: string; bootstrapEmails: string[] };
let staff: { accountId: string; email: string; bootstrapEmails: string[] };
beforeAll(async () => {
  const a = await provisionAccount(db, { email: 'directory-owner@example.test' });
  const b = await provisionAccount(db, { email: 'directory-staff@example.test' });
  if (!isOk(a) || !isOk(b)) throw new Error('synthetic accounts');
  owner = { accountId: a.value.id, email: a.value.email, bootstrapEmails: [a.value.email] };
  staff = { accountId: b.value.id, email: b.value.email, bootstrapEmails: [] };
  const grant = await grantPlatformRole(db, {
    actor: owner,
    targetAccountId: owner.accountId,
    role: 'PLATFORM_OWNER',
    reason: 'Synthetic owner',
    stepUpSatisfied: true,
  });
  if (!isOk(grant)) throw new Error('synthetic owner role');
  const support = await grantPlatformRole(db, {
    actor: owner,
    targetAccountId: staff.accountId,
    role: 'SUPPORT_ADMIN',
    reason: 'Synthetic support',
    stepUpSatisfied: true,
  });
  if (!isOk(support)) throw new Error('synthetic support role');
  await db
    .insert(schema.accounts)
    .values(
      Array.from({ length: 54 }, (_, i) => ({ email: `synthetic-directory-${i}@example.test` })),
    );
});
afterAll(async () => {
  await client.close();
});

describe('owner-only bounded member directory', () => {
  it('denies platform support and does not revive bootstrap access after grants exist', async () => {
    const denied = await listPlatformMembers(db, { ...staff, bootstrapEmails: [staff.email] });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('forbidden');
    const invalidDenied = await listPlatformMembers(db, staff, 'invalid');
    if (!invalidDenied.ok) expect(invalidDenied.error.code).toBe('forbidden');
  });
  it('paginates all accounts without overlap and excludes provider identifiers and credentials', async () => {
    const first = await listPlatformMembers(db, owner);
    expect(first.ok).toBe(true);
    if (!first.ok || !first.value.next) throw new Error('first page');
    expect(first.value.members).toHaveLength(50);
    expect(Object.keys(first.value.members[0] ?? {}).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerifiedAt',
      'id',
    ]);
    const second = await listPlatformMembers(db, owner, first.value.next);
    if (!second.ok) throw new Error('second page');
    expect(second.value.members).toHaveLength(6);
    expect(second.value.next).toBeNull();
    expect(
      new Set([...first.value.members, ...second.value.members].map((member) => member.id)).size,
    ).toBe(56);
  });
  it('rejects malformed cursors after authorization', async () => {
    const result = await listPlatformMembers(db, owner, 'not-a-uuid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid');
  });
  it('denies a revoked owner even if its email remains in the bootstrap list', async () => {
    const account = await provisionAccount(db, { email: 'revoked-directory-owner@example.test' });
    if (!isOk(account)) throw new Error('account');
    const grant = await grantPlatformRole(db, {
      actor: owner,
      targetAccountId: account.value.id,
      role: 'PLATFORM_OWNER',
      reason: 'Synthetic temporary owner',
      stepUpSatisfied: true,
    });
    if (!isOk(grant)) throw new Error('grant');
    const actor = {
      accountId: account.value.id,
      email: account.value.email,
      bootstrapEmails: [account.value.email],
    };
    expect((await listPlatformMembers(db, actor)).ok).toBe(true);
    const revoked = await revokePlatformRole(db, {
      actor: owner,
      grantId: grant.value.id,
      reason: 'Synthetic revoke',
      stepUpSatisfied: true,
    });
    expect(revoked.ok).toBe(true);
    const denied = await listPlatformMembers(db, actor);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('forbidden');
  });
});

describe('member directory read with options (WP-SB7)', () => {
  it('pages 20 at a time, newest first, without losing or repeating anyone', async () => {
    const all = await listPlatformMembers(db, owner, undefined, { limit: 100 });
    if (!all.ok) throw new Error('first page');
    expect(all.value.members).toHaveLength(20);
    const seen: string[] = [];
    let before: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listPlatformMembers(db, owner, undefined, before ? { before } : {});
      if (!page.ok) throw new Error('page');
      expect(page.value.members.length).toBeLessThanOrEqual(20);
      seen.push(...page.value.members.map((member) => member.id));
      if (!page.value.next) break;
      before = page.value.next;
    }
    const total = (await db.select({ id: schema.accounts.id }).from(schema.accounts)).length;
    expect(total).toBeGreaterThan(40);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });

  it('matches part of an email, any case, with % and _ as plain text, never more than 20', async () => {
    const found = await listPlatformMembers(db, owner, undefined, {
      emailSearch: ' SYNTHETIC-DIRECTORY-1',
    });
    if (!found.ok) throw new Error('search');
    // 1 and 10 to 19.
    expect(found.value.members).toHaveLength(11);
    expect(Object.keys(found.value.members[0] ?? {}).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerifiedAt',
      'id',
    ]);
    const wide = await listPlatformMembers(db, owner, undefined, { emailSearch: 'example' });
    if (!wide.ok) throw new Error('search');
    expect(wide.value.members).toHaveLength(20);
    expect(wide.value.next).not.toBeNull();
    const wildcard = await listPlatformMembers(db, owner, undefined, { emailSearch: '%' });
    expect(wildcard.ok && wildcard.value.members).toEqual([]);
    const underscore = await listPlatformMembers(db, owner, undefined, { emailSearch: '_' });
    expect(underscore.ok && underscore.value.members).toEqual([]);
  });

  it('gives the first page for a malformed cursor or one made for another search', async () => {
    const first = await listPlatformMembers(db, owner, undefined, {});
    const other = await listPlatformMembers(db, owner, undefined, { emailSearch: 'example' });
    if (!first.ok || !other.ok) throw new Error('pages');
    const firstIds = first.value.members.map((member) => member.id);
    for (const before of [other.value.next ?? '', 'not-a-cursor', 'x'.repeat(600)]) {
      const page = await listPlatformMembers(db, owner, undefined, { before });
      expect(page.ok && page.value.members.map((member) => member.id)).toEqual(firstIds);
    }
  });

  it('never returns more than 20, whatever limit is asked for', async () => {
    for (const limit of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 500, 0]) {
      const page = await listPlatformMembers(db, owner, undefined, { limit });
      if (!page.ok) throw new Error('page');
      expect(page.value.members.length).toBeLessThanOrEqual(20);
      expect(page.value.members.length).toBeGreaterThan(0);
    }
  });

  it('still refuses anyone who is not a platform owner', async () => {
    const denied = await listPlatformMembers(db, staff, undefined, { emailSearch: 'example' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('forbidden');
  });
});
