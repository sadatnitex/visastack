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
