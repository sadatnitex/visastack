import { randomBytes } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import { type Db, schema as dbSchema } from './db';
import type { KeyManagementPort } from './ports';
import {
  editFact,
  isProtectedPlaceholder,
  listApplicantProfile,
  registerFieldDefinition,
} from './profile';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';

/**
 * WALD2: the stand-in a keyless read shows for a protected detail ("[protected]") is never a value.
 * Whoever calls the write path, it refuses that stand-in (and its look-alikes) instead of storing it
 * over the real, encrypted value. Synthetic data only.
 */

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

const PLACEHOLDER_LOOKALIKES = [
  '[protected]',
  ' [protected] ',
  '[PROTECTED]',
  '[ Protected ]',
  '[protected: could not decrypt]',
  '[Protected: Could Not Decrypt]',
];

describe('editFact refuses the protected stand-in as a value', () => {
  let db: Db;
  let accountId: string;
  let applicantId: string;
  const port = fakeKeyManagementPort();

  beforeEach(async () => {
    const client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    resetProtectedFieldKeyCacheForTests();
    const provisioned = await provisionAccount(db, { email: 'wald2@example.com' });
    if (!isOk(provisioned)) throw new Error('provision failed');
    accountId = provisioned.value.id;
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName: 'Test Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant creation failed');
    applicantId = applicant.value.id;
    await registerFieldDefinition(db, {
      key: 'passport_number',
      dataType: 'string',
      sensitivity: 'RESTRICTED',
    });
    await registerFieldDefinition(db, { key: 'nickname', dataType: 'string' });
  });

  it.each(PLACEHOLDER_LOOKALIKES)(
    'keeps the stored protected value when %j is saved over it',
    async (lookalike) => {
      const first = await editFact(db, {
        actorAccountId: accountId,
        applicantId,
        fieldKey: 'passport_number',
        value: 'X1234567',
        encryption: port,
      });
      expect(isOk(first)).toBe(true);
      const before = await db.select().from(dbSchema.factVersions);

      const second = await editFact(db, {
        actorAccountId: accountId,
        applicantId,
        fieldKey: 'passport_number',
        value: lookalike,
        encryption: port,
      });
      expect(isOk(second)).toBe(false);
      if (isOk(second)) return;
      expect(second.error.code).toBe('invalid');
      // The refusal never repeats the value it was given.
      expect(second.error.message.toLowerCase()).not.toContain('protected]');

      const after = await db.select().from(dbSchema.factVersions);
      expect(after).toHaveLength(before.length);
      const read = await listApplicantProfile(db, applicantId, port);
      expect(read.find((e) => e.fieldKey === 'passport_number')?.value).toBe('X1234567');
    },
  );

  it('refuses the stand-in for an ordinary field too, so it can never become plain text anywhere', async () => {
    const result = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'nickname',
      value: '[protected]',
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.code).toBe('invalid');
    expect(await db.select().from(dbSchema.factVersions)).toHaveLength(0);
  });

  it('still saves ordinary text that only mentions the word', async () => {
    const result = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'nickname',
      value: 'protected species ranger',
    });
    expect(isOk(result)).toBe(true);
  });

  it('isProtectedPlaceholder recognises the look-alikes and nothing else', () => {
    for (const value of PLACEHOLDER_LOOKALIKES) expect(isProtectedPlaceholder(value)).toBe(true);
    for (const value of [null, '', 'protected', 'X1234567', '[protected species]']) {
      expect(isProtectedPlaceholder(value)).toBe(false);
    }
  });

  it('another account cannot read the decrypted values: its edit is refused and nothing is revealed', async () => {
    await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'passport_number',
      value: 'X1234567',
      encryption: port,
    });
    const stranger = await provisionAccount(db, { email: 'stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision failed');
    const attempt = await editFact(db, {
      actorAccountId: stranger.value.id,
      applicantId,
      fieldKey: 'passport_number',
      value: 'Y7654321',
      encryption: port,
    });
    expect(isOk(attempt)).toBe(false);
    if (isOk(attempt)) return;
    expect(attempt.error.code).toBe('forbidden');
    expect(attempt.error.message).not.toContain('X1234567');
  });
});
