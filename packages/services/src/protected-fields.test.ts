import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import { type Db, schema as dbSchema } from './db';
import type { KeyManagementPort } from './ports';
import {
  editFact,
  listApplicantProfile,
  registerFieldDefinition,
  revealFactVersionValue,
} from './profile';
import {
  buildAccountExportAad,
  buildFactVersionAad,
  protectBytes,
  protectValue,
  requiresProtection,
  resetProtectedFieldKeyCacheForTests,
  revealBytes,
  revealValue,
} from './protected-fields';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

/** A deterministic, fixed-key test double — NOT the local adapter under test elsewhere, so these tests exercise the service logic independently of any one adapter's wrapping scheme. */
function fakeKeyManagementPort(keyVersion = 'test-v1'): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 7);
  return {
    currentKeyVersion: () => keyVersion,
    async generateDataKey() {
      return {
        keyVersion,
        plaintextDataKey: randomBytes(32),
        wrappedDataKey: masterKey, // not real wrapping — fine, this port unwraps to a fixed key regardless.
      };
    },
    async unwrapDataKey(version) {
      if (version !== keyVersion) throw new Error(`unknown key version ${version}`);
      return masterKey;
    },
  };
}

describe('protected-fields — envelope encryption primitives', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
  });

  it('requiresProtection is true only for SENSITIVE/RESTRICTED', () => {
    expect(requiresProtection('STANDARD')).toBe(false);
    expect(requiresProtection('SENSITIVE')).toBe(true);
    expect(requiresProtection('RESTRICTED')).toBe(true);
  });

  it('round-trips a value through protectValue/revealValue', async () => {
    const port = fakeKeyManagementPort();
    const aad = buildFactVersionAad({
      applicantId: 'app-1',
      factId: 'fact-1',
      fieldKey: 'passport_number',
      factVersionId: 'ver-1',
    });
    const protected_ = await protectValue(db, port, 'X1234567', aad);
    expect(protected_.keyVersion).toBe('test-v1');
    // The plaintext must never appear verbatim in the stored ciphertext bytes.
    expect(Buffer.from(protected_.ciphertext).includes('X1234567')).toBe(false);

    const revealed = await revealValue(db, port, {
      ciphertext: protected_.ciphertext,
      nonce: protected_.nonce,
      keyVersion: protected_.keyVersion,
      aad,
    });
    expect(revealed).toBe('X1234567');
  });

  it('uses a fresh random nonce on every encryption, even for the same value', async () => {
    const port = fakeKeyManagementPort();
    const aad = buildFactVersionAad({
      applicantId: 'app-1',
      factId: 'fact-1',
      fieldKey: 'k',
      factVersionId: 'v1',
    });
    const first = await protectValue(db, port, 'same value', aad);
    const second = await protectValue(db, port, 'same value', aad);
    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
  });

  it('fails to decrypt when the AAD does not match what it was encrypted under (tamper/reuse detection)', async () => {
    const port = fakeKeyManagementPort();
    const correctAad = buildFactVersionAad({
      applicantId: 'app-1',
      factId: 'fact-1',
      fieldKey: 'k',
      factVersionId: 'v1',
    });
    const wrongAad = buildFactVersionAad({
      applicantId: 'app-2', // different applicant — simulates a copied/moved ciphertext
      factId: 'fact-1',
      fieldKey: 'k',
      factVersionId: 'v1',
    });
    const protected_ = await protectValue(db, port, 'secret', correctAad);
    await expect(
      revealValue(db, port, {
        ciphertext: protected_.ciphertext,
        nonce: protected_.nonce,
        keyVersion: protected_.keyVersion,
        aad: wrongAad,
      }),
    ).rejects.toThrow();
  });

  it('fails to decrypt tampered ciphertext bytes', async () => {
    const port = fakeKeyManagementPort();
    const aad = buildFactVersionAad({
      applicantId: 'a',
      factId: 'f',
      fieldKey: 'k',
      factVersionId: 'v',
    });
    const protected_ = await protectValue(db, port, 'secret', aad);
    const tampered = Buffer.from(protected_.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await expect(
      revealValue(db, port, {
        ciphertext: tampered,
        nonce: protected_.nonce,
        keyVersion: protected_.keyVersion,
        aad,
      }),
    ).rejects.toThrow();
  });

  it('persists exactly one wrapped data key row per key version, reused across calls', async () => {
    const port = fakeKeyManagementPort('shared-v1');
    const aad1 = buildFactVersionAad({
      applicantId: 'a',
      factId: 'f1',
      fieldKey: 'k',
      factVersionId: 'v1',
    });
    const aad2 = buildFactVersionAad({
      applicantId: 'a',
      factId: 'f2',
      fieldKey: 'k',
      factVersionId: 'v2',
    });
    await protectValue(db, port, 'one', aad1);
    await protectValue(db, port, 'two', aad2);
    const rows = await db.select().from(dbSchema.dataKeys);
    expect(rows.filter((r) => r.keyVersion === 'shared-v1')).toHaveLength(1);
  });
});

describe('protected-fields - protectBytes/revealBytes (account export artifacts)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
  });

  it('round-trips arbitrary binary bytes, including ones that are not valid UTF-8', async () => {
    const port = fakeKeyManagementPort();
    const aad = buildAccountExportAad({ jobId: 'job-1' });
    // 0xC0 0x80 is an overlong/invalid UTF-8 sequence - proves this path
    // never round-trips through a string encoding the way protectValue does.
    const original = new Uint8Array([0, 1, 2, 0xff, 0xc0, 0x80, 255, 254, 253]);
    const protected_ = await protectBytes(db, port, original, aad);
    expect(protected_.keyVersion).toBe('test-v1');

    const revealed = await revealBytes(db, port, {
      ciphertext: protected_.ciphertext,
      nonce: protected_.nonce,
      keyVersion: protected_.keyVersion,
      aad,
    });
    expect(Buffer.from(revealed).equals(Buffer.from(original))).toBe(true);
  });

  it('round-trips a realistically-sized artifact (a few hundred KB)', async () => {
    const port = fakeKeyManagementPort();
    const aad = buildAccountExportAad({ jobId: 'job-large' });
    const original = randomBytes(256 * 1024);
    const protected_ = await protectBytes(db, port, original, aad);
    const revealed = await revealBytes(db, port, {
      ciphertext: protected_.ciphertext,
      nonce: protected_.nonce,
      keyVersion: protected_.keyVersion,
      aad,
    });
    expect(Buffer.from(revealed).equals(original)).toBe(true);
  });

  it('fails to decrypt when the AAD does not match - a ciphertext copied onto a different export job', async () => {
    const port = fakeKeyManagementPort();
    const protected_ = await protectBytes(
      db,
      port,
      new Uint8Array([1, 2, 3]),
      buildAccountExportAad({ jobId: 'job-a' }),
    );
    await expect(
      revealBytes(db, port, {
        ciphertext: protected_.ciphertext,
        nonce: protected_.nonce,
        keyVersion: protected_.keyVersion,
        aad: buildAccountExportAad({ jobId: 'job-b' }),
      }),
    ).rejects.toThrow();
  });

  it('shares the same data-key cache/table as protectValue - no separate key material is generated for bytes', async () => {
    const port = fakeKeyManagementPort('shared-bytes-v1');
    await protectValue(
      db,
      port,
      'x',
      buildFactVersionAad({ applicantId: 'a', factId: 'f', fieldKey: 'k', factVersionId: 'v' }),
    );
    await protectBytes(db, port, new Uint8Array([1]), buildAccountExportAad({ jobId: 'j' }));
    const rows = await db.select().from(dbSchema.dataKeys);
    expect(rows.filter((r) => r.keyVersion === 'shared-bytes-v1')).toHaveLength(1);
  });
});

describe('protected-fields — wired into editFact/listApplicantProfile', () => {
  let db: Db;
  let accountId: string;
  let applicantId: string;

  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
    const provisioned = await provisionAccount(db, { email: 'traveller@example.com' });
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
      displayName: 'Traveller One',
    });
    if (!isOk(applicant)) throw new Error('applicant creation failed');
    applicantId = applicant.value.id;
    await registerFieldDefinition(db, {
      key: 'passport_number',
      dataType: 'string',
      sensitivity: 'RESTRICTED',
    });
  });

  it('refuses to write a RESTRICTED field with no encryption port (fails closed, never silently plaintext)', async () => {
    const result = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'passport_number',
      value: 'X1234567',
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.code).toBe('encryption_unavailable');
  });

  it('never stores a RESTRICTED value in the plaintext column, and it never appears in the raw ciphertext bytes', async () => {
    const port = fakeKeyManagementPort();
    const result = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'passport_number',
      value: 'X1234567',
      encryption: port,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const rows = await db.select().from(dbSchema.factVersions);
    const row = rows.find((r) => r.id === result.value.version.id);
    expect(row).toBeDefined();
    expect(row?.value).toBeNull();
    expect(row?.protectedKeyVersion).toBe('test-v1');
    expect(row?.valueCiphertext).not.toBeNull();
    expect(Buffer.from(row?.valueCiphertext ?? []).includes('X1234567')).toBe(false);
  });

  it('round-trips a RESTRICTED value through listApplicantProfile with the port, and shows a placeholder without it', async () => {
    const port = fakeKeyManagementPort();
    const result = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'passport_number',
      value: 'X1234567',
      encryption: port,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    // Fact isn't "current" until the pointer is set — editFact does this atomically, so listApplicantProfile sees it immediately.
    const withPort = await listApplicantProfile(db, applicantId, port);
    const entry = withPort.find((e) => e.fieldKey === 'passport_number');
    expect(entry?.value).toBe('X1234567');

    const withoutPort = await listApplicantProfile(db, applicantId);
    const entryNoPort = withoutPort.find((e) => e.fieldKey === 'passport_number');
    expect(entryNoPort?.value).toBe('[protected]');
  });

  it('revealFactVersionValue decrypts a specific version and passes through a plaintext STANDARD field unchanged', async () => {
    await registerFieldDefinition(db, { key: 'nickname', dataType: 'string' });
    const plainResult = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'nickname',
      value: 'Nas',
    });
    expect(isOk(plainResult)).toBe(true);
    if (!isOk(plainResult)) return;
    const plainRevealed = await revealFactVersionValue(
      db,
      fakeKeyManagementPort(),
      plainResult.value.version,
    );
    expect(isOk(plainRevealed)).toBe(true);
    if (isOk(plainRevealed)) expect(plainRevealed.value).toBe('Nas');

    const port = fakeKeyManagementPort();
    const protectedResult = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'passport_number',
      value: 'X1234567',
      encryption: port,
    });
    expect(isOk(protectedResult)).toBe(true);
    if (!isOk(protectedResult)) return;
    const revealed = await revealFactVersionValue(db, port, protectedResult.value.version);
    expect(isOk(revealed)).toBe(true);
    if (isOk(revealed)) expect(revealed.value).toBe('X1234567');
  });

  it("a wrong key management port cannot decrypt another port's protected value", async () => {
    const port = fakeKeyManagementPort('port-a');
    const result = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'passport_number',
      value: 'X1234567',
      encryption: port,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    // Clear the in-process unwrapped-key cache first — without this, the
    // cache (keyed only by key-version label, correctly so: a real
    // deployment runs exactly one configured KeyManagementPort, never two
    // competing ones) would still hold port-a's already-unwrapped key from
    // the write above and short-circuit before otherPort's unwrapDataKey is
    // ever consulted. Resetting simulates a fresh process — e.g. a restart,
    // or a second deployment — which is the realistic case this test means
    // to prove: a port that never had port-a's master key cannot unwrap
    // data protected under it.
    resetProtectedFieldKeyCacheForTests();
    const otherPort = fakeKeyManagementPort('port-b');
    const revealed = await revealFactVersionValue(db, otherPort, result.value.version);
    expect(isOk(revealed)).toBe(false);
  });
});
