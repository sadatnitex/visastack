import { randomBytes } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  type KeyManagementPort,
  createApplicant,
  editFact,
  provisionAccount,
  registerFieldDefinition,
  resetProtectedFieldKeyCacheForTests,
  setConsent,
} from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ESS1: the profile page no longer carries protected values, so Show and Edit open one at a time
 * through revealProfileValueAction. Only the owner of the record gets a value; another signed-in
 * person, a fact of another record, a missing record and a page with no key all get the same empty
 * refusal. Real database, real key path, two made-up people, synthetic values.
 */

const ctx = vi.hoisted(() => ({
  db: undefined as unknown,
  accountId: '',
  port: undefined as unknown,
  keyCalls: 0,
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (c: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: ctx.db, accountId: ctx.accountId }),
}));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: () => {
    ctx.keyCalls += 1;
    return ctx.port;
  },
}));
const reportServerError = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/server-error', () => ({ reportServerError }));

const { revealProfileValueAction } = await import('./profile-reveal-actions');

function fakeKeyManagementPort(keyVersion = 'test-v1'): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 7);
  return {
    currentKeyVersion: () => keyVersion,
    async generateDataKey() {
      return { keyVersion, plaintextDataKey: randomBytes(32), wrappedDataKey: masterKey };
    },
    async unwrapDataKey(version) {
      if (version !== keyVersion) throw new Error(`unknown key version ${version}`);
      return masterKey;
    },
  };
}

describe('revealProfileValueAction', () => {
  let db: Db;
  const port = fakeKeyManagementPort();
  let owner: string;
  let stranger: string;
  let ownersPerson: string;
  let strangersPerson: string;
  let ownersFact: string;
  let strangersFact: string;

  async function person(email: string, value: string) {
    const account = await provisionAccount(db, { email });
    if (!isOk(account)) throw new Error('provision failed');
    await setConsent(db, {
      actorAccountId: account.value.id,
      accountId: account.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: account.value.id,
      ownerAccountId: account.value.id,
      displayName: 'Made-up Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant creation failed');
    const saved = await editFact(db, {
      actorAccountId: account.value.id,
      applicantId: applicant.value.id,
      fieldKey: 'passport_number',
      value,
      encryption: port,
    });
    if (!isOk(saved)) throw new Error('seed save failed');
    return {
      accountId: account.value.id,
      applicantId: applicant.value.id,
      factId: saved.value.version.factId,
    };
  }

  beforeEach(async () => {
    const client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    resetProtectedFieldKeyCacheForTests();
    ctx.db = db;
    ctx.port = port;
    await registerFieldDefinition(db, {
      key: 'passport_number',
      dataType: 'string',
      sensitivity: 'RESTRICTED',
    });
    const a = await person('ess1-owner@example.com', 'X1234567');
    const b = await person('ess1-stranger@example.com', 'Z7654321');
    owner = a.accountId;
    ownersPerson = a.applicantId;
    ownersFact = a.factId;
    stranger = b.accountId;
    strangersPerson = b.applicantId;
    strangersFact = b.factId;
    ctx.accountId = owner;
    ctx.keyCalls = 0;
  });

  it('opens the owner’s own protected value', async () => {
    expect(await revealProfileValueAction(ownersPerson, ownersFact)).toEqual({
      ok: true,
      value: 'X1234567',
    });
  });

  it('refuses another signed-in person, without opening anything with the key', async () => {
    ctx.accountId = stranger;
    expect(await revealProfileValueAction(ownersPerson, ownersFact)).toEqual({ ok: false });
    expect(ctx.keyCalls).toBe(0);
  });

  it('refuses a fact of another record named under the owner’s own record', async () => {
    expect(await revealProfileValueAction(ownersPerson, strangersFact)).toEqual({ ok: false });
  });

  it('refuses the owner asking under someone else’s record', async () => {
    expect(await revealProfileValueAction(strangersPerson, strangersFact)).toEqual({ ok: false });
    expect(await revealProfileValueAction(strangersPerson, ownersFact)).toEqual({ ok: false });
    expect(ctx.keyCalls).toBe(0);
  });

  it('answers a missing or malformed record exactly as a refused one', async () => {
    const refused = await revealProfileValueAction(strangersPerson, strangersFact);
    expect(
      await revealProfileValueAction('00000000-0000-4000-8000-000000000000', ownersFact),
    ).toEqual(refused);
    expect(await revealProfileValueAction('not-an-id', ownersFact)).toEqual(refused);
    expect(await revealProfileValueAction('', ownersFact)).toEqual(refused);
    expect(await revealProfileValueAction(ownersPerson, '')).toEqual(refused);
    expect(await revealProfileValueAction(ownersPerson, 'x'.repeat(101))).toEqual(refused);
  });

  it('gives nothing, never the stand-in, when this server has no key', async () => {
    ctx.port = undefined;
    expect(await revealProfileValueAction(ownersPerson, ownersFact)).toEqual({ ok: false });
  });

  it('gives nothing when the value will not open with the key', async () => {
    ctx.port = fakeKeyManagementPort('other-version');
    resetProtectedFieldKeyCacheForTests();
    const result = await revealProfileValueAction(ownersPerson, ownersFact);
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain('protected');
  });

  it('never writes the value to any log, on success or failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );
    try {
      reportServerError.mockClear();
      await revealProfileValueAction(ownersPerson, ownersFact);
      ctx.accountId = stranger;
      await revealProfileValueAction(ownersPerson, ownersFact);
      ctx.accountId = owner;
      ctx.port = fakeKeyManagementPort('other-version');
      resetProtectedFieldKeyCacheForTests();
      await revealProfileValueAction(ownersPerson, ownersFact);
      const logged = JSON.stringify([
        ...spies.flatMap((spy) => spy.mock.calls),
        ...reportServerError.mock.calls.map((call) => String(call[1])),
      ]);
      expect(logged).not.toContain('X1234567');
      expect(logged).not.toContain('Z7654321');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
