import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAccountByWorkosUserId, provisionAccount } from './accounts';
import type { Db } from './db';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function countIdentityBindings(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.eventType, 'ACCOUNT_IDENTITY_BOUND'));
  return rows.length;
}

describe('account identity binding (WorkOS immutable id)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('binds a fresh account to the WorkOS id and is idempotent on repeat sign-in', async () => {
    const first = await provisionAccount(db, {
      email: 'user@example.com',
      workosUserId: 'user_W1',
      emailVerified: true,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.workosUserId).toBe('user_W1');

    const again = await provisionAccount(db, {
      email: 'user@example.com',
      workosUserId: 'user_W1',
      emailVerified: true,
    });
    expect(isOk(again)).toBe(true);
    if (isOk(again)) expect(again.value.id).toBe(first.value.id);

    const all = await db.select().from(schema.accounts);
    expect(all).toHaveLength(1);
  });

  it('does NOT create a duplicate when the same identity signs in with a changed email', async () => {
    const created = await provisionAccount(db, {
      email: 'old@example.com',
      workosUserId: 'user_W1',
      emailVerified: true,
    });
    if (!isOk(created)) throw new Error('provision failed');

    // WorkOS keeps the same id; the user changed their email.
    const changed = await provisionAccount(db, {
      email: 'new@example.com',
      workosUserId: 'user_W1',
      emailVerified: true,
    });
    expect(isOk(changed)).toBe(true);
    if (isOk(changed)) {
      expect(changed.value.id).toBe(created.value.id);
      expect(changed.value.email).toBe('new@example.com'); // mutable contact data
    }
    expect(await db.select().from(schema.accounts)).toHaveLength(1);
  });

  it('claims a legacy (unbound) account by verified email, once, and audits it', async () => {
    // Legacy account created before identity binding (no workosUserId).
    const legacy = await provisionAccount(db, { email: 'legacy@example.com' });
    if (!isOk(legacy)) throw new Error('provision failed');
    expect(legacy.value.workosUserId).toBeNull();

    const bound = await provisionAccount(db, {
      email: 'legacy@example.com',
      workosUserId: 'user_W9',
      emailVerified: true,
    });
    expect(isOk(bound)).toBe(true);
    if (isOk(bound)) {
      expect(bound.value.id).toBe(legacy.value.id); // same row, now bound
      expect(bound.value.workosUserId).toBe('user_W9');
    }
    expect(await countIdentityBindings(db)).toBe(1);
  });

  it('refuses to claim a legacy account when the email is NOT verified (fail closed)', async () => {
    await provisionAccount(db, { email: 'legacy2@example.com' });

    const attempt = await provisionAccount(db, {
      email: 'legacy2@example.com',
      workosUserId: 'user_W2',
      emailVerified: false,
    });
    expect(isErr(attempt)).toBe(true);
    if (isErr(attempt)) expect(attempt.error.code).toBe('forbidden');

    // The legacy account remains unbound.
    const byId = await getAccountByWorkosUserId(db, 'user_W2');
    expect(byId).toBeUndefined();
  });

  it('refuses a different identity signing in with an email already bound (account-takeover guard)', async () => {
    // Victim owns victim@example.com bound to W_VICTIM.
    const victim = await provisionAccount(db, {
      email: 'victim@example.com',
      workosUserId: 'user_VICTIM',
      emailVerified: true,
    });
    if (!isOk(victim)) throw new Error('provision failed');

    // Attacker's WorkOS identity presents the same email address.
    const attack = await provisionAccount(db, {
      email: 'victim@example.com',
      workosUserId: 'user_ATTACKER',
      emailVerified: true,
    });
    expect(isErr(attack)).toBe(true);
    if (isErr(attack)) expect(attack.error.code).toBe('forbidden');

    // The victim account is untouched and still bound to the victim id.
    const stillVictim = await getAccountByWorkosUserId(db, 'user_VICTIM');
    expect(stillVictim?.id).toBe(victim.value.id);
    expect(await getAccountByWorkosUserId(db, 'user_ATTACKER')).toBeUndefined();
  });

  it('keeps two distinct identities as two distinct accounts', async () => {
    const a = await provisionAccount(db, {
      email: 'a@example.com',
      workosUserId: 'user_A',
      emailVerified: true,
    });
    const b = await provisionAccount(db, {
      email: 'b@example.com',
      workosUserId: 'user_B',
      emailVerified: true,
    });
    expect(isOk(a) && isOk(b)).toBe(true);
    if (isOk(a) && isOk(b)) expect(a.value.id).not.toBe(b.value.id);
    expect(await db.select().from(schema.accounts)).toHaveLength(2);
  });
});
