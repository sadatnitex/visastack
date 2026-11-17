import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { type Db, provisionAccount } from '@visastack/services';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * When a passkey may stand in for a recent password (Q8), against a real database: only with the
 * switch on, only for this sign-in, only for this account, and never for staff.
 */

const session = vi.hoisted(() => ({
  db: undefined as unknown,
  accountId: '',
  email: '',
  ref: 'ref-now' as string | null,
}));

vi.mock('./session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string; email: string }) => unknown) =>
    fn({ db: session.db, accountId: session.accountId, email: session.email }),
}));
vi.mock('./neon-recency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./neon-recency')>()),
  neonSessionRef: async () => session.ref,
}));

async function setUp(options: { table?: boolean } = {}): Promise<Db> {
  const client = await createMigratedPglite();
  // Migration 0137 makes the table; dropping it shows the site before the owner applies it.
  if (options.table === false) await client.exec('drop table passkey_credentials');
  const db = drizzle(client, { schema }) as unknown as Db;
  const account = await provisionAccount(db, { email: 'traveller@example.com' });
  if (!isOk(account)) throw new Error('provision failed');
  session.db = db;
  session.accountId = account.value.id;
  session.email = 'traveller@example.com';
  session.ref = 'ref-now';
  return db;
}

async function recordUse(db: Db, ref: string, secondsAgo: number): Promise<void> {
  await db.execute(sql`
    insert into passkey_credentials
      (account_id, credential_id, public_key, device_type, label, last_used_at, last_used_session_ref)
    values (${session.accountId}, ${`cred-${ref}-${secondsAgo}`}, '\\x01', 'multiDevice', 'Phone',
      now() - make_interval(secs => ${secondsAgo}), ${ref})`);
}

beforeEach(() => {
  vi.stubEnv('PASSKEYS', 'on');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('passkeyConfirmationAgeSeconds', () => {
  it('returns how long ago this sign-in was confirmed with a passkey', async () => {
    const db = await setUp();
    await recordUse(db, 'ref-now', 40);
    const { passkeyConfirmationAgeSeconds } = await import('./passkey-recency');
    const age = await passkeyConfirmationAgeSeconds(session.accountId);
    expect(age).toBeGreaterThanOrEqual(39);
    expect(age).toBeLessThan(120);
  }, 30_000);

  it('ignores a passkey used in an earlier sign-in (signed out and in again)', async () => {
    const db = await setUp();
    await recordUse(db, 'ref-before-sign-out', 10);
    session.ref = 'ref-after-sign-in';
    const { passkeyConfirmationAgeSeconds } = await import('./passkey-recency');
    expect(await passkeyConfirmationAgeSeconds(session.accountId)).toBe(Number.POSITIVE_INFINITY);
  }, 30_000);

  it('is never used while the switch is off, for another account, or without a sign-in', async () => {
    const db = await setUp();
    await recordUse(db, 'ref-now', 10);
    const { passkeyConfirmationAgeSeconds } = await import('./passkey-recency');
    expect(await passkeyConfirmationAgeSeconds('someone-else')).toBe(Number.POSITIVE_INFINITY);
    vi.stubEnv('PASSKEYS', 'yes');
    expect(await passkeyConfirmationAgeSeconds(session.accountId)).toBe(Number.POSITIVE_INFINITY);
    vi.stubEnv('PASSKEYS', 'on');
    session.ref = null;
    expect(await passkeyConfirmationAgeSeconds(session.accountId)).toBe(Number.POSITIVE_INFINITY);
  }, 30_000);

  it('never counts for staff: the password rule stays exactly as it was', async () => {
    const db = await setUp();
    await recordUse(db, 'ref-now', 10);
    // The bootstrap staff address holds a platform role without any grant row.
    vi.stubEnv('ADMIN_EMAILS', 'traveller@example.com');
    const { passkeyConfirmationAgeSeconds } = await import('./passkey-recency');
    expect(await passkeyConfirmationAgeSeconds(session.accountId)).toBe(Number.POSITIVE_INFINITY);
  }, 30_000);

  it('asks for the password while the passkey table is not there yet', async () => {
    await setUp({ table: false });
    const { passkeyConfirmationAgeSeconds } = await import('./passkey-recency');
    expect(await passkeyConfirmationAgeSeconds(session.accountId)).toBe(Number.POSITIVE_INFINITY);
  }, 30_000);
});
