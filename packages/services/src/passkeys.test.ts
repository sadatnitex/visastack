import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite, migrationsFolder } from '@visastack/db/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  PASSKEY_LIMIT,
  type PasskeyRelyingParty,
  finishPasskeyConfirmation,
  finishPasskeyRegistration,
  hasPasskey,
  listPasskeys,
  normalisePasskeyLabel,
  passkeyConfirmedAt,
  removePasskey,
  renamePasskey,
  startPasskeyConfirmation,
  startPasskeyRegistration,
} from './passkeys';
import { SoftPasskey } from './passkeys.test-support';

const RP: PasskeyRelyingParty = {
  rpID: 'vs.example.test',
  origin: 'https://vs.example.test',
  rpName: 'VisaStack',
};

/**
 * The passkey table, applied from its re-runnable SQL. Until the owner's migration is in the
 * journal it waits in packages/db/pending; afterwards it is found in the migrations folder.
 */
function passkeyMigration(): string {
  const marker = 'CREATE TABLE IF NOT EXISTS "passkey_credentials"';
  const folders = [migrationsFolder, join(migrationsFolder, '..', 'pending')];
  for (const folder of folders) {
    let names: string[] = [];
    try {
      names = readdirSync(folder).filter((name) => name.endsWith('.sql'));
    } catch {
      continue;
    }
    for (const name of names) {
      const text = readFileSync(join(folder, name), 'utf8');
      if (text.includes(marker)) return text;
    }
  }
  throw new Error('the passkey migration is missing');
}

async function freshDb(options: { withTable?: boolean } = {}): Promise<Db> {
  const client = await createMigratedPglite();
  if (options.withTable !== false) {
    const statements = passkeyMigration()
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter(Boolean);
    for (const statement of statements) await client.exec(statement);
  }
  return drizzle(client, { schema }) as unknown as Db;
}

async function account(db: Db, email = 'traveller@example.com'): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error('provision failed');
  return result.value.id;
}

async function addPasskey(
  db: Db,
  accountId: string,
  key: SoftPasskey,
  label = 'My Phone',
): Promise<string> {
  const options = await startPasskeyRegistration(db, { accountId, email: 'x@example.com', rp: RP });
  if (!isOk(options)) throw new Error('registration options failed');
  const saved = await finishPasskeyRegistration(db, {
    accountId,
    rp: RP,
    expectedChallenge: options.value.challenge,
    response: key.register(options.value.challenge),
    label,
  });
  if (!isOk(saved)) throw new Error(`registration failed: ${saved.error.message}`);
  return saved.value.id;
}

async function confirmWith(
  db: Db,
  accountId: string,
  key: SoftPasskey,
  sessionRef = 'session-a',
): Promise<Awaited<ReturnType<typeof finishPasskeyConfirmation>>> {
  const options = await startPasskeyConfirmation(db, { accountId, rp: RP });
  if (!isOk(options)) throw new Error('confirmation options failed');
  return finishPasskeyConfirmation(db, {
    accountId,
    rp: RP,
    expectedChallenge: options.value.challenge,
    response: key.confirm(options.value.challenge),
    sessionRef,
  });
}

async function auditRows(db: Db): Promise<{ event_type: string; metadata: unknown }[]> {
  const result = (await db.execute(
    sql`select event_type, metadata from audit_events where resource_type = 'passkey' order by seq`,
  )) as unknown as { rows: { event_type: string; metadata: unknown }[] };
  return result.rows;
}

describe('passkeys', () => {
  it('adds a passkey, lists it without its key, and confirms this sign-in with it', async () => {
    const db = await freshDb();
    const accountId = await account(db);
    const key = new SoftPasskey(RP);
    await addPasskey(db, accountId, key, '  Work   Laptop ');
    const list = await listPasskeys(db, accountId);
    expect(list.state).toBe('ok');
    if (list.state !== 'ok') return;
    expect(list.passkeys).toHaveLength(1);
    expect(list.passkeys[0]?.label).toBe('Work Laptop');
    expect(Object.keys(list.passkeys[0] ?? {}).sort()).toEqual(
      ['createdAt', 'id', 'label', 'lastUsedAt', 'synced'].sort(),
    );
    expect(await passkeyConfirmedAt(db, { accountId, sessionRef: 'session-a' })).toBeNull();
    const confirmed = await confirmWith(db, accountId, key);
    expect(isOk(confirmed)).toBe(true);
    const at = await passkeyConfirmedAt(db, { accountId, sessionRef: 'session-a' });
    expect(at).toBeInstanceOf(Date);
  });

  it('binds a confirmation to one sign-in: another session ref finds nothing', async () => {
    const db = await freshDb();
    const accountId = await account(db);
    const key = new SoftPasskey(RP);
    await addPasskey(db, accountId, key);
    expect(isOk(await confirmWith(db, accountId, key, 'old-sign-in'))).toBe(true);
    // Signed out and back in: a new Neon session id gives a new ref, and the old proof is gone.
    expect(await passkeyConfirmedAt(db, { accountId, sessionRef: 'new-sign-in' })).toBeNull();
    expect(await passkeyConfirmedAt(db, { accountId, sessionRef: 'old-sign-in' })).not.toBeNull();
  });

  it("refuses another account's passkey and an answer for the wrong challenge or site", async () => {
    const db = await freshDb();
    const owner = await account(db, 'owner@example.com');
    const other = await account(db, 'other@example.com');
    const ownerKey = new SoftPasskey(RP);
    const otherKey = new SoftPasskey(RP);
    await addPasskey(db, owner, ownerKey);
    await addPasskey(db, other, otherKey);

    const options = await startPasskeyConfirmation(db, { accountId: owner, rp: RP });
    if (!isOk(options)) throw new Error('options failed');
    const challenge = options.value.challenge;
    const crossAccount = await finishPasskeyConfirmation(db, {
      accountId: owner,
      rp: RP,
      expectedChallenge: challenge,
      response: otherKey.confirm(challenge),
      sessionRef: 's',
    });
    expect(isErr(crossAccount)).toBe(true);
    const wrongChallenge = await finishPasskeyConfirmation(db, {
      accountId: owner,
      rp: RP,
      expectedChallenge: challenge,
      response: ownerKey.confirm('c29tZS1vdGhlci1jaGFsbGVuZ2U'),
      sessionRef: 's',
    });
    expect(isErr(wrongChallenge)).toBe(true);
    const wrongSite = await finishPasskeyConfirmation(db, {
      accountId: owner,
      rp: RP,
      expectedChallenge: challenge,
      response: ownerKey.confirm(challenge, 'https://evil.example.test'),
      sessionRef: 's',
    });
    expect(isErr(wrongSite)).toBe(true);
    expect(await passkeyConfirmedAt(db, { accountId: owner, sessionRef: 's' })).toBeNull();
  });

  it('refuses the same challenge twice and a counter that goes backwards', async () => {
    const db = await freshDb();
    const accountId = await account(db);
    const key = new SoftPasskey({ ...RP, counter: 5 });
    await addPasskey(db, accountId, key);
    const options = await startPasskeyConfirmation(db, { accountId, rp: RP });
    if (!isOk(options)) throw new Error('options failed');
    const challenge = options.value.challenge;
    const first = await finishPasskeyConfirmation(db, {
      accountId,
      rp: RP,
      expectedChallenge: challenge,
      response: key.confirm(challenge),
      sessionRef: 's',
    });
    expect(isOk(first)).toBe(true);
    const replay = await finishPasskeyConfirmation(db, {
      accountId,
      rp: RP,
      expectedChallenge: challenge,
      response: key.confirm(challenge),
      sessionRef: 's2',
    });
    expect(isErr(replay)).toBe(true);
    expect(await passkeyConfirmedAt(db, { accountId, sessionRef: 's2' })).toBeNull();

    key.setCounter(2);
    const backwards = await confirmWith(db, accountId, key, 's3');
    expect(isErr(backwards)).toBe(true);
    expect(await passkeyConfirmedAt(db, { accountId, sessionRef: 's3' })).toBeNull();
  });

  it('refuses a passkey made without a fingerprint, face or PIN check', async () => {
    const db = await freshDb();
    const accountId = await account(db);
    const options = await startPasskeyRegistration(db, { accountId, email: 'x@e.com', rp: RP });
    if (!isOk(options)) throw new Error('options failed');
    const weak = new SoftPasskey({ ...RP, withoutUserVerification: true });
    const saved = await finishPasskeyRegistration(db, {
      accountId,
      rp: RP,
      expectedChallenge: options.value.challenge,
      response: weak.register(options.value.challenge),
      label: null,
    });
    expect(isErr(saved)).toBe(true);
    expect(await hasPasskey(db, accountId)).toBe(false);
  });

  it('keeps at most the limit, refuses a duplicate, and renames and removes only its own', async () => {
    const db = await freshDb();
    const accountId = await account(db);
    const other = await account(db, 'other@example.com');
    const ids: string[] = [];
    for (let index = 0; index < PASSKEY_LIMIT; index += 1) {
      ids.push(await addPasskey(db, accountId, new SoftPasskey(RP)));
    }
    const full = await startPasskeyRegistration(db, { accountId, email: 'x@e.com', rp: RP });
    expect(isErr(full)).toBe(true);

    const firstId = ids[0] ?? '';
    expect(isErr(await renamePasskey(db, { accountId: other, id: firstId, label: 'x' }))).toBe(
      true,
    );
    expect(isErr(await removePasskey(db, { accountId: other, id: firstId }))).toBe(true);
    expect(isOk(await renamePasskey(db, { accountId, id: firstId, label: 'Tablet' }))).toBe(true);
    expect(isOk(await removePasskey(db, { accountId, id: firstId }))).toBe(true);
    const list = await listPasskeys(db, accountId);
    expect(list.state === 'ok' ? list.passkeys.length : -1).toBe(PASSKEY_LIMIT - 1);

    const twice = new SoftPasskey(RP);
    await addPasskey(db, other, twice);
    const again = await startPasskeyRegistration(db, {
      accountId: other,
      email: 'o@e.com',
      rp: RP,
    });
    if (!isOk(again)) throw new Error('options failed');
    const duplicate = await finishPasskeyRegistration(db, {
      accountId: other,
      rp: RP,
      expectedChallenge: again.value.challenge,
      response: twice.register(again.value.challenge),
      label: 'Again',
    });
    expect(isErr(duplicate)).toBe(true);
  });

  it('reports unavailable, never allowed, while the table is missing', async () => {
    const db = await freshDb({ withTable: false });
    const accountId = await account(db);
    expect(await listPasskeys(db, accountId)).toEqual({ state: 'unavailable' });
    expect(await hasPasskey(db, accountId)).toBeNull();
    expect(await passkeyConfirmedAt(db, { accountId, sessionRef: 's' })).toBeNull();
    expect(isErr(await startPasskeyRegistration(db, { accountId, email: 'x@e.com', rp: RP }))).toBe(
      true,
    );
    expect(isErr(await startPasskeyConfirmation(db, { accountId, rp: RP }))).toBe(true);
  });

  it('audits kinds and counts only, never a credential id, key, address or session ref', async () => {
    const db = await freshDb();
    const accountId = await account(db, 'private-person@example.com');
    const key = new SoftPasskey(RP);
    const id = await addPasskey(db, accountId, key);
    await confirmWith(db, accountId, key, 'secret-session-ref');
    await confirmWith(db, accountId, new SoftPasskey(RP), 'secret-session-ref');
    await removePasskey(db, { accountId, id });
    const rows = await auditRows(db);
    expect(rows.map((row) => row.event_type)).toEqual([
      'PASSKEY_ADDED',
      'PASSKEY_CONFIRMED',
      'PASSKEY_CHECK_FAILED',
      'PASSKEY_REMOVED',
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(key.id);
    expect(text).not.toContain('private-person');
    expect(text).not.toContain('secret-session-ref');
  });

  it('cleans labels into something short and readable', () => {
    expect(normalisePasskeyLabel(null)).toBe('Passkey');
    expect(normalisePasskeyLabel('  a\u0000b\nc  ')).toBe('a b c');
    expect(normalisePasskeyLabel('x'.repeat(200))).toHaveLength(60);
  });
});
