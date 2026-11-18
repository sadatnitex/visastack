import { randomBytes } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  type KeyManagementPort,
  PROFILE_VALUE_ACCESS,
  createApplicant,
  editFact,
  provisionAccount,
  registerFieldDefinition,
  resetProtectedFieldKeyCacheForTests,
  setConsent,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
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

const { revealProfileValueAction, revealSuggestionValueAction } = await import(
  './profile-reveal-actions'
);

function fakeKeyManagementPort(
  keyVersion = 'test-v1',
  known: readonly string[] = [keyVersion],
  unwrapped: string[] = [],
): KeyManagementPort {
  // Each version's data key is its own fixed bytes, so a later unwrap gives back the same key.
  const dataKey = (version: string) => Buffer.alloc(32, version.length + 7);
  return {
    currentKeyVersion: () => keyVersion,
    async generateDataKey() {
      return {
        keyVersion,
        plaintextDataKey: Buffer.from(dataKey(keyVersion)),
        wrappedDataKey: randomBytes(32),
      };
    },
    async unwrapDataKey(version) {
      if (!known.includes(version)) throw new Error(`unknown key version ${version}`);
      unwrapped.push(version);
      return dataKey(version);
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

  const events = () =>
    db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, PROFILE_VALUE_ACCESS));

  it('audits an opened value as ALLOWED with the field key, never the value', async () => {
    await revealProfileValueAction(ownersPerson, ownersFact);
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      result: 'ALLOWED',
      applicantId: ownersPerson,
      resourceType: 'profile_fact',
      resourceId: ownersFact,
    });
    expect(rows[0]?.metadata).toEqual({ fieldKey: 'passport_number' });
    expect(JSON.stringify(rows)).not.toContain('X1234567');
  });

  it('audits a refusal as DENIED, for a stranger and for a value that will not open', async () => {
    ctx.accountId = stranger;
    await revealProfileValueAction(ownersPerson, ownersFact);
    ctx.accountId = owner;
    ctx.port = undefined;
    await revealProfileValueAction(ownersPerson, ownersFact);
    const rows = await events();
    expect(rows.map((row) => row.result)).toEqual(['DENIED', 'DENIED']);
    // One reason for a made-up record and someone else's (the prober reads their own rows).
    expect(rows.map((row) => row.reason)).toEqual(['refused', 'no_key']);
    expect(rows[0]?.actorAccountId).toBe(stranger);
    // The stranger's row names no record column, so it reads alike for a real and a made-up id.
    expect(rows[0]?.applicantId).toBeNull();
    expect(JSON.stringify(rows)).not.toContain('X1234567');
    expect(JSON.stringify(rows)).not.toContain('Z7654321');
  });

  it('still opens a value saved before encryption when the key setting fails', async () => {
    const [fact] = await db.select().from(schema.facts).where(eq(schema.facts.id, ownersFact));
    await db
      .update(schema.factVersions)
      .set({
        value: 'L7654321',
        valueCiphertext: null,
        valueNonce: null,
        protectedKeyVersion: null,
      })
      .where(eq(schema.factVersions.id, fact?.currentVersionId as string));
    ctx.port = undefined;
    expect(await revealProfileValueAction(ownersPerson, ownersFact)).toEqual({
      ok: true,
      value: 'L7654321',
    });
  });

  it('opens only the fact asked for, never the rest of the profile', async () => {
    await registerFieldDefinition(db, {
      key: 'date_of_birth',
      dataType: 'string',
      sensitivity: 'SENSITIVE',
    });
    const later = fakeKeyManagementPort('test-v9', ['test-v9']);
    const saved = await editFact(db, {
      actorAccountId: owner,
      applicantId: ownersPerson,
      fieldKey: 'date_of_birth',
      value: '1990-04-12',
      encryption: later,
    });
    if (!isOk(saved)) throw new Error('second seed save failed');
    resetProtectedFieldKeyCacheForTests();
    const unwrapped: string[] = [];
    ctx.port = fakeKeyManagementPort('test-v9', ['test-v1', 'test-v9'], unwrapped);
    expect(await revealProfileValueAction(ownersPerson, saved.value.version.factId)).toEqual({
      ok: true,
      value: '1990-04-12',
    });
    // Only the Date of Birth's key was opened; the passport number (test-v1) stayed shut.
    expect(unwrapped).toEqual(['test-v9']);
  });

  it('opens nothing for a suggestion that is not one of the owner\u2019s', async () => {
    expect(await revealSuggestionValueAction(ownersPerson, ownersFact)).toEqual({ ok: false });
    ctx.accountId = stranger;
    expect(await revealSuggestionValueAction(ownersPerson, ownersFact)).toEqual({ ok: false });
    const rows = await events();
    expect(rows.every((row) => row.result === 'DENIED')).toBe(true);
    expect(rows.map((row) => row.resourceType)).toEqual(['ai_suggestion', 'ai_suggestion']);
  });

  it('words a refused row without saying whether the record exists', async () => {
    ctx.accountId = stranger;
    await revealProfileValueAction('00000000-0000-4000-8000-000000000000', ownersFact);
    await revealProfileValueAction(ownersPerson, ownersFact);
    await revealProfileValueAction('not-an-id', ownersFact);
    const rows = await events();
    expect(rows.map((row) => row.reason)).toEqual(['refused', 'refused', 'malformed_id']);
    expect(rows.every((row) => row.applicantId === null)).toBe(true);
  });
});
