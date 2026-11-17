import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { selfPrincipal } from './access/principal';
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

async function freshDb(options: { withTable?: boolean } = {}): Promise<Db> {
  // Migration 0137 makes the table; dropping it shows the site before the owner applies it.
  const client = await createMigratedPglite();
  if (options.withTable === false) await client.exec('drop table passkey_credentials');
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
  const saved = await finishPasskeyRegistration(db, selfPrincipal(accountId), {
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
  const challengeIssuedAt = new Date();
  const options = await startPasskeyConfirmation(db, { accountId, rp: RP });
  if (!isOk(options)) throw new Error('confirmation options failed');
  return finishPasskeyConfirmation(db, selfPrincipal(accountId), {
    rp: RP,
    expectedChallenge: options.value.challenge,
    challengeIssuedAt,
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

    const issuedAt = new Date();
    const options = await startPasskeyConfirmation(db, { accountId: owner, rp: RP });
    if (!isOk(options)) throw new Error('options failed');
    const challenge = options.value.challenge;
    const crossAccount = await finishPasskeyConfirmation(db, selfPrincipal(owner), {
      rp: RP,
      expectedChallenge: challenge,
      challengeIssuedAt: issuedAt,
      response: otherKey.confirm(challenge),
      sessionRef: 's',
    });
    expect(isErr(crossAccount)).toBe(true);
    const wrongChallenge = await finishPasskeyConfirmation(db, selfPrincipal(owner), {
      rp: RP,
      expectedChallenge: challenge,
      challengeIssuedAt: issuedAt,
      response: ownerKey.confirm('c29tZS1vdGhlci1jaGFsbGVuZ2U'),
      sessionRef: 's',
    });
    expect(isErr(wrongChallenge)).toBe(true);
    const wrongSite = await finishPasskeyConfirmation(db, selfPrincipal(owner), {
      rp: RP,
      expectedChallenge: challenge,
      challengeIssuedAt: issuedAt,
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
    const issuedAt = new Date();
    const options = await startPasskeyConfirmation(db, { accountId, rp: RP });
    if (!isOk(options)) throw new Error('options failed');
    const challenge = options.value.challenge;
    const first = await finishPasskeyConfirmation(db, selfPrincipal(accountId), {
      rp: RP,
      expectedChallenge: challenge,
      challengeIssuedAt: issuedAt,
      response: key.confirm(challenge),
      sessionRef: 's',
    });
    expect(isOk(first)).toBe(true);
    const replay = await finishPasskeyConfirmation(db, selfPrincipal(accountId), {
      rp: RP,
      expectedChallenge: challenge,
      challengeIssuedAt: issuedAt,
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

  it('refuses an older answer kept back after a newer one was used, even with no counter', async () => {
    const db = await freshDb();
    const accountId = await account(db);
    const key = new SoftPasskey(RP);
    await addPasskey(db, accountId, key);
    const olderIssuedAt = new Date(Date.now() - 60_000);
    const older = await startPasskeyConfirmation(db, { accountId, rp: RP });
    if (!isOk(older)) throw new Error('options failed');
    const keptBack = key.confirm(older.value.challenge);
    expect(isOk(await confirmWith(db, accountId, key, 's-new'))).toBe(true);
    const replayed = await finishPasskeyConfirmation(db, selfPrincipal(accountId), {
      rp: RP,
      expectedChallenge: older.value.challenge,
      challengeIssuedAt: olderIssuedAt,
      response: keptBack,
      sessionRef: 's-attacker',
    });
    expect(isErr(replayed)).toBe(true);
    expect(await passkeyConfirmedAt(db, { accountId, sessionRef: 's-attacker' })).toBeNull();
  });

  it('refuses a passkey made without a fingerprint, face or PIN check', async () => {
    const db = await freshDb();
    const accountId = await account(db);
    const options = await startPasskeyRegistration(db, { accountId, email: 'x@e.com', rp: RP });
    if (!isOk(options)) throw new Error('options failed');
    const weak = new SoftPasskey({ ...RP, withoutUserVerification: true });
    const saved = await finishPasskeyRegistration(db, selfPrincipal(accountId), {
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
    expect(isErr(await removePasskey(db, selfPrincipal(other), { id: firstId }))).toBe(true);
    expect(isOk(await renamePasskey(db, { accountId, id: firstId, label: 'Tablet' }))).toBe(true);
    expect(isOk(await removePasskey(db, selfPrincipal(accountId), { id: firstId }))).toBe(true);
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
    const duplicate = await finishPasskeyRegistration(db, selfPrincipal(other), {
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
    await removePasskey(db, selfPrincipal(accountId), { id });
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

describe('the session scope', () => {
  it('refuses a scope that is not a genuine, fresh one from the session, before any read', async () => {
    const forged = { kind: 'self', accountId: '11111111-1111-4111-8111-111111111111' } as never;
    const untouched = {} as Db;
    const removed = await removePasskey(untouched, forged, { id: 'x' });
    expect(isErr(removed) && removed.error.code).toBe('forbidden');
    const confirmed = await finishPasskeyConfirmation(untouched, forged, {} as never);
    expect(isErr(confirmed) && confirmed.error.code).toBe('forbidden');
    const saved = await finishPasskeyRegistration(untouched, forged, {} as never);
    expect(isErr(saved) && saved.error.code).toBe('forbidden');
  });
});
