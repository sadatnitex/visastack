import { randomBytes } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  type KeyManagementPort,
  createApplicant,
  editFact,
  listApplicantProfile,
  provisionAccount,
  registerFieldDefinition,
  resetProtectedFieldKeyCacheForTests,
  setConsent,
} from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WALD2: a form post that carries the stand-in "[protected]" (what a keyless read shows for a
 * protected detail) is refused by the save action itself, with plain words, and the stored
 * encrypted value is left exactly as it was. Real database, real key path, synthetic values.
 */

const ctx = vi.hoisted(() => ({
  db: undefined as unknown,
  accountId: '',
  port: undefined as unknown,
  editFactCalls: 0,
}));

vi.mock('@visastack/services', async (importOriginal) => {
  const real = await importOriginal<typeof import('@visastack/services')>();
  return {
    ...real,
    editFact: (...args: Parameters<typeof real.editFact>) => {
      ctx.editFactCalls += 1;
      return real.editFact(...args);
    },
  };
});
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (c: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: ctx.db, accountId: ctx.accountId }),
}));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => ctx.port }));
vi.mock('../../../../lib/change-impact-read', () => ({
  readDetailChangeImpact: async () => 'refused',
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({ triggerIntakeWorker: vi.fn() }));
vi.mock('../../../../lib/providers-media', () => ({ createPreviewRenderer: () => undefined }));

const { saveFactAction } = await import('./actions');

function fakeKeyManagementPort(keyVersion = 'test-v1'): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 9);
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

function post(applicantId: string, value: string) {
  const data = new FormData();
  data.set('applicantId', applicantId);
  data.set('fieldKey', 'passport_number');
  data.set('value', value);
  return saveFactAction({ ok: true, message: '' }, data);
}

describe('saveFactAction and the protected stand-in', () => {
  let db: Db;
  let applicantId: string;
  const port = fakeKeyManagementPort();

  beforeEach(async () => {
    const client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    resetProtectedFieldKeyCacheForTests();
    ctx.db = db;
    ctx.port = port;
    ctx.editFactCalls = 0;
    const account = await provisionAccount(db, { email: 'wald2-action@example.com' });
    if (!isOk(account)) throw new Error('provision failed');
    ctx.accountId = account.value.id;
    await setConsent(db, {
      actorAccountId: ctx.accountId,
      accountId: ctx.accountId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: ctx.accountId,
      ownerAccountId: ctx.accountId,
      displayName: 'Test Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant creation failed');
    applicantId = applicant.value.id;
    await registerFieldDefinition(db, {
      key: 'passport_number',
      dataType: 'string',
      sensitivity: 'RESTRICTED',
    });
    const saved = await editFact(db, {
      actorAccountId: ctx.accountId,
      applicantId,
      fieldKey: 'passport_number',
      value: 'X1234567',
      encryption: port,
    });
    if (!isOk(saved)) throw new Error('seed save failed');
    ctx.editFactCalls = 0;
  });

  it.each(['[protected]', '  [Protected]  ', '[protected: could not decrypt]'])(
    'refuses %j in plain words and leaves the stored ciphertext unchanged',
    async (value) => {
      const before = await db.select().from(schema.factVersions);
      const result = await post(applicantId, value);
      expect(result.ok).toBe(false);
      expect(result.message).toBe(
        'This detail is saved and protected. Type the new value to change it, or leave it as it is.',
      );
      expect(result.message).not.toContain('[');
      // Refused before the service is asked at all (defence in depth).
      expect(ctx.editFactCalls).toBe(0);
      const after = await db.select().from(schema.factVersions);
      expect(after).toEqual(before);
      const read = await listApplicantProfile(db, applicantId, port);
      expect(read.find((e) => e.fieldKey === 'passport_number')?.value).toBe('X1234567');
    },
  );

  it('an empty post never overwrites the protected value', async () => {
    const before = await db.select().from(schema.factVersions);
    const result = await post(applicantId, '   ');
    expect(result.ok).toBe(false);
    expect(await db.select().from(schema.factVersions)).toEqual(before);
  });

  it('a real new value is still saved and read back decrypted', async () => {
    const result = await post(applicantId, 'Z7654321');
    expect(result.ok).toBe(true);
    const read = await listApplicantProfile(db, applicantId, port);
    expect(read.find((e) => e.fieldKey === 'passport_number')?.value).toBe('Z7654321');
  });
});
