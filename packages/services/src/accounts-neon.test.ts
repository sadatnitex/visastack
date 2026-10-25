import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { getAccountByNeonUserId, provisionNeonAccount } from './accounts-neon';
import type { Db } from './db';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

async function auditCount(db: Db, eventType: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.eventType, eventType as never));
  return rows.length;
}

describe('Neon account provisioning', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('creates a bound, verified account for a confirmed address and is idempotent', async () => {
    const first = await provisionNeonAccount(db, {
      email: ' Ana@Example.com ',
      neonUserId: 'neon-1',
      emailVerified: true,
    });
    if (!isOk(first)) throw new Error('expected ok');
    expect(first.value.email).toBe('ana@example.com');
    expect(first.value.neonUserId).toBe('neon-1');
    expect(first.value.emailVerifiedAt).not.toBeNull();
    const again = await provisionNeonAccount(db, {
      email: 'ana@example.com',
      neonUserId: 'neon-1',
      emailVerified: true,
    });
    if (!isOk(again)) throw new Error('expected ok');
    expect(again.value.id).toBe(first.value.id);
    expect(await auditCount(db, 'ACCOUNT_PROVISIONED')).toBe(1);
  });

  it('never provisions or links an unconfirmed address', async () => {
    const created = await provisionNeonAccount(db, {
      email: 'new@example.com',
      neonUserId: 'neon-2',
      emailVerified: false,
    });
    expect(isErr(created)).toBe(true);
    // An existing account must not be taken over by someone who only registered its address.
    await provisionAccount(db, { email: 'owner@example.com' });
    const takeover = await provisionNeonAccount(db, {
      email: 'owner@example.com',
      neonUserId: 'neon-attacker',
      emailVerified: false,
    });
    expect(isErr(takeover)).toBe(true);
    expect(await getAccountByNeonUserId(db, 'neon-attacker')).toBeUndefined();
    const rows = await db.select().from(schema.accounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.neonUserId).toBeNull();
  });

  it('requires recovery instead of transferring a legacy account on verified email alone', async () => {
    const legacy = await provisionAccount(db, {
      email: 'pilot@example.com',
      workosUserId: 'user_01ABC',
      emailVerified: true,
    });
    if (!isOk(legacy)) throw new Error('expected ok');
    const before = (await db.select().from(schema.accounts))[0];
    const result = await provisionNeonAccount(db, {
      email: 'pilot@example.com',
      neonUserId: 'neon-3',
      emailVerified: true,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'identity_recovery_required',
        message: 'Account access needs additional verification.',
      },
    });
    expect(await db.select().from(schema.accounts)).toEqual([before]);
    expect(await getAccountByNeonUserId(db, 'neon-3')).toBeUndefined();
    expect(await auditCount(db, 'ACCOUNT_IDENTITY_CONFLICT')).toBe(1);
  });

  it('refuses concurrent verified identities without changing or duplicating a legacy account', async () => {
    await provisionAccount(db, { email: 'race@example.com', workosUserId: 'user_RACE' });
    const before = await db.select().from(schema.accounts);
    const results = await Promise.all(
      ['neon-race-a', 'neon-race-b'].map((neonUserId) =>
        provisionNeonAccount(db, { email: 'race@example.com', neonUserId, emailVerified: true }),
      ),
    );
    expect(results.every(isErr)).toBe(true);
    expect(await db.select().from(schema.accounts)).toEqual(before);
    expect(await auditCount(db, 'ACCOUNT_IDENTITY_CONFLICT')).toBe(2);
  });

  it('refuses a different Neon identity for an address already bound to another, and audits it', async () => {
    await provisionNeonAccount(db, {
      email: 'bound@example.com',
      neonUserId: 'neon-a',
      emailVerified: true,
    });
    const other = await provisionNeonAccount(db, {
      email: 'bound@example.com',
      neonUserId: 'neon-b',
      emailVerified: true,
    });
    expect(other).toEqual({
      ok: false,
      error: {
        code: 'identity_recovery_required',
        message: 'Account access needs additional verification.',
      },
    });
    expect(await auditCount(db, 'ACCOUNT_IDENTITY_CONFLICT')).toBe(1);
    expect(await getAccountByNeonUserId(db, 'neon-b')).toBeUndefined();
  });

  it('resolves by the immutable id first, so a known identity always reaches its own account', async () => {
    const created = await provisionNeonAccount(db, {
      email: 'id@example.com',
      neonUserId: 'neon-c',
      emailVerified: true,
    });
    if (!isOk(created)) throw new Error('expected ok');
    const found = await getAccountByNeonUserId(db, 'neon-c');
    expect(found?.id).toBe(created.value.id);
    const legacy = await provisionAccount(db, {
      email: 'other@example.com',
      workosUserId: 'user_OTHER',
    });
    if (!isOk(legacy)) throw new Error('expected ok');
    const again = await provisionNeonAccount(db, {
      email: 'other@example.com',
      neonUserId: 'neon-c',
      emailVerified: true,
    });
    if (!isOk(again)) throw new Error('expected ok');
    expect(again.value.id).toBe(created.value.id);
    const other = (
      await db.select().from(schema.accounts).where(eq(schema.accounts.id, legacy.value.id))
    )[0];
    expect(other?.neonUserId).toBeNull();
    expect(other?.workosUserId).toBe('user_OTHER');
    expect(await getAccountByNeonUserId(db, '  ')).toBeUndefined();
  });

  it('rejects an empty identity or address', async () => {
    expect(
      isErr(
        await provisionNeonAccount(db, { email: 'a@b.co', neonUserId: ' ', emailVerified: true }),
      ),
    ).toBe(true);
    expect(
      isErr(
        await provisionNeonAccount(db, { email: 'nope', neonUserId: 'x', emailVerified: true }),
      ),
    ).toBe(true);
  });
});
