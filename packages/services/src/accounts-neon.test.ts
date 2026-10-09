import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { getAccountByNeonUserId, provisionNeonAccount } from './accounts-neon';
import type { Db } from './db';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
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

  it('links an existing pilot account on the first confirmed sign-in, once, with an audit event', async () => {
    const legacy = await provisionAccount(db, {
      email: 'pilot@example.com',
      workosUserId: 'user_01ABC',
      emailVerified: true,
    });
    if (!isOk(legacy)) throw new Error('expected ok');
    const linked = await provisionNeonAccount(db, {
      email: 'pilot@example.com',
      neonUserId: 'neon-3',
      emailVerified: true,
    });
    if (!isOk(linked)) throw new Error('expected ok');
    expect(linked.value.id).toBe(legacy.value.id);
    expect(linked.value.neonUserId).toBe('neon-3');
    expect(linked.value.workosUserId).toBe('user_01ABC');
    expect(await auditCount(db, 'ACCOUNT_IDENTITY_BOUND')).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(schema.accounts)).length).toBe(1);
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
    expect(isErr(other)).toBe(true);
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
