import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { systemScopeForTest } from './access/system-scope.test-support';
import { rewrapDataKeys } from './data-key-rewrap';
import type { Db } from './db';
import type { GeneratedDataKey, KeyManagementPort, RewrappingKeyManagementPort } from './ports';
import { protectValue, resetProtectedFieldKeyCacheForTests, revealValue } from './protected-fields';

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

function aesWrap(master: Buffer, plain: Uint8Array, aad: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', master, nonce);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}
function aesUnwrap(master: Buffer, wrapped: Uint8Array, aad: string): Uint8Array {
  const blob = Buffer.from(wrapped);
  const decipher = createDecipheriv('aes-256-gcm', master, blob.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

const LOCAL = Buffer.alloc(32, 1);
const KMS = Buffer.alloc(32, 2);

/** The development key only: wraps with the local master, records no wrapping id. */
const localOnly: KeyManagementPort = {
  currentKeyVersion: () => 'local-v1',
  async generateDataKey(): Promise<GeneratedDataKey> {
    const plaintextDataKey = randomBytes(32);
    return {
      keyVersion: 'local-v1',
      plaintextDataKey,
      wrappedDataKey: aesWrap(LOCAL, plaintextDataKey, 'local'),
    };
  },
  async unwrapDataKey(_version, wrapped) {
    return aesUnwrap(LOCAL, wrapped, 'local');
  },
};

/** A key service stand-in: new keys under kms-v1, wrapping bound to the version, old local keys opened only when allowed. */
function kmsPort(options: {
  legacy: boolean;
  failRewrapFor?: string;
}): RewrappingKeyManagementPort {
  return {
    currentKeyVersion: () => 'kms-v1',
    wrappingKeyPrefix: () => 'fake-kms:',
    async generateDataKey() {
      const plaintextDataKey = randomBytes(32);
      return {
        keyVersion: 'kms-v1',
        plaintextDataKey,
        wrappedDataKey: aesWrap(KMS, plaintextDataKey, 'kms:kms-v1'),
        wrappingKeyId: 'fake-kms:key-1',
      };
    },
    async rewrapDataKey(version, plain) {
      if (version === options.failRewrapFor) throw new Error('key service refused');
      return {
        wrappedDataKey: aesWrap(KMS, plain, `kms:${version}`),
        wrappingKeyId: 'fake-kms:key-1',
      };
    },
    async unwrapDataKey(version, wrapped, wrappingKeyId) {
      if (wrappingKeyId?.startsWith('fake-kms:')) return aesUnwrap(KMS, wrapped, `kms:${version}`);
      if (!options.legacy) throw new Error('no legacy local key');
      return aesUnwrap(LOCAL, wrapped, 'local');
    },
  };
}

const scope = () => systemScopeForTest('rewrap-data-keys');

describe('moving data keys from the local key to the key service (S26)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
  });

  it('moves every key, leaves every encrypted value readable, and needs the local key no more', async () => {
    const before = await protectValue(db, localOnly, 'passport L898902C3', 'aad-1');
    resetProtectedFieldKeyCacheForTests();
    // While both exist: the old value opens through the legacy key, a new write uses the key service.
    const during = kmsPort({ legacy: true });
    expect(
      await revealValue(db, during, { ...before, ciphertext: before.ciphertext, aad: 'aad-1' }),
    ).toBe('passport L898902C3');
    const fresh = await protectValue(db, during, 'second value', 'aad-2');
    expect(fresh.keyVersion).toBe('kms-v1');

    const summary = await rewrapDataKeys(db, scope(), during);
    expect(summary).toMatchObject({
      alreadyCurrent: 1,
      rewrapped: 1,
      skipped: 0,
      failed: 0,
      remaining: 0,
      available: true,
    });

    // The local key is no longer needed: neither value needs it.
    resetProtectedFieldKeyCacheForTests();
    const after = kmsPort({ legacy: false });
    expect(await revealValue(db, after, { ...before, aad: 'aad-1' })).toBe('passport L898902C3');
    expect(await revealValue(db, after, { ...fresh, aad: 'aad-2' })).toBe('second value');
    const rows = await db.select().from(schema.dataKeys);
    expect(rows.every((row) => row.wrappingKeyId === 'fake-kms:key-1')).toBe(true);
  });

  it('is idempotent: a second run moves nothing', async () => {
    await protectValue(db, localOnly, 'value', 'aad');
    const port = kmsPort({ legacy: true });
    await rewrapDataKeys(db, scope(), port);
    const again = await rewrapDataKeys(db, scope(), port);
    expect(again).toMatchObject({ rewrapped: 0, remaining: 0, alreadyCurrent: 1, failed: 0 });
  });

  it('resumes after a stop: a small batch moves some, the next run finishes the rest', async () => {
    for (const version of ['local-a', 'local-b', 'local-c']) {
      await db.insert(schema.dataKeys).values({
        keyVersion: version,
        wrappedDataKey: aesWrap(LOCAL, randomBytes(32), 'local'),
      });
    }
    const port = kmsPort({ legacy: true });
    const first = await rewrapDataKeys(db, scope(), port, { batchSize: 2 });
    expect(first).toMatchObject({ rewrapped: 2, remaining: 1 });
    const second = await rewrapDataKeys(db, scope(), port, { batchSize: 2 });
    expect(second).toMatchObject({ rewrapped: 1, remaining: 0, alreadyCurrent: 2 });
  });

  it('leaves a key it cannot open or wrap untouched and carries on with the rest', async () => {
    await db.insert(schema.dataKeys).values({
      keyVersion: 'broken',
      wrappedDataKey: Buffer.from('not a wrapped key at all, just garbage bytes!!'),
    });
    await db.insert(schema.dataKeys).values({
      keyVersion: 'refused',
      wrappedDataKey: aesWrap(LOCAL, randomBytes(32), 'local'),
    });
    await db.insert(schema.dataKeys).values({
      keyVersion: 'fine',
      wrappedDataKey: aesWrap(LOCAL, randomBytes(32), 'local'),
    });
    const summary = await rewrapDataKeys(
      db,
      scope(),
      kmsPort({ legacy: true, failRewrapFor: 'refused' }),
    );
    expect(summary).toMatchObject({ rewrapped: 1, failed: 2, remaining: 2 });
    const broken = await db
      .select()
      .from(schema.dataKeys)
      .where(eq(schema.dataKeys.keyVersion, 'broken'));
    expect(broken[0]?.wrappingKeyId).toBeNull();
  });

  it('skips a key that changed while it was being moved, rather than overwriting it', async () => {
    await db.insert(schema.dataKeys).values({
      keyVersion: 'racing',
      wrappedDataKey: aesWrap(LOCAL, randomBytes(32), 'local'),
    });
    const racing: RewrappingKeyManagementPort = {
      ...kmsPort({ legacy: true }),
      async rewrapDataKey(version, plain) {
        // Someone else changes the stored key between our read and our write.
        await db
          .update(schema.dataKeys)
          .set({ wrappedDataKey: aesWrap(LOCAL, randomBytes(32), 'local') })
          .where(eq(schema.dataKeys.keyVersion, version));
        return kmsPort({ legacy: true }).rewrapDataKey(version, plain);
      },
    };
    const summary = await rewrapDataKeys(db, scope(), racing);
    expect(summary).toMatchObject({ rewrapped: 0, skipped: 1, remaining: 1 });
  });

  it('does not replace the old wrapping with one it cannot open again', async () => {
    await db.insert(schema.dataKeys).values({
      keyVersion: 'write-only',
      wrappedDataKey: aesWrap(LOCAL, randomBytes(32), 'local'),
    });
    const before = (await db.select().from(schema.dataKeys))[0];
    const good = kmsPort({ legacy: true });
    // A key service that accepts a wrap but cannot open it again.
    const writeOnly: RewrappingKeyManagementPort = {
      ...good,
      async unwrapDataKey(version, wrapped, id) {
        if (id?.startsWith('fake-kms:')) throw new Error('AccessDenied');
        return good.unwrapDataKey(version, wrapped, id);
      },
    };
    const summary = await rewrapDataKeys(db, scope(), writeOnly);
    expect(summary).toMatchObject({ rewrapped: 0, failed: 1, remaining: 1 });
    expect(summary.failedBy).toEqual({ open: 0, wrap: 0, verify: 1 });
    const after = (await db.select().from(schema.dataKeys))[0];
    expect(
      Buffer.from(after?.wrappedDataKey ?? []).equals(Buffer.from(before?.wrappedDataKey ?? [])),
    ).toBe(true);
    expect(after?.wrappingKeyId).toBeNull();
  });

  it('records each run once in the audit trail, with counts only', async () => {
    await protectValue(db, localOnly, 'value', 'aad');
    await rewrapDataKeys(db, scope(), kmsPort({ legacy: true }));
    const events = (await db.select().from(schema.auditEvents)).filter(
      (event) => event.eventType === 'DATA_KEYS_REWRAPPED',
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ rewrapped: 1, skipped: 0, failed: 0, remaining: 0 });
    expect(events[0]?.method).toBe('SYSTEM');
  });

  it('never remembers a key created inside a transaction that rolls back', async () => {
    const port = kmsPort({ legacy: false });
    await db
      .transaction(async (tx) => {
        await protectValue(tx as unknown as Db, port, 'lost', 'aad-lost');
        throw new Error('something later in the transaction failed');
      })
      .catch(() => undefined);
    expect(await db.select().from(schema.dataKeys)).toHaveLength(0);
    // The next write generates and saves a key afresh, and a new process can open the value.
    const kept = await protectValue(db, port, 'kept', 'aad-kept');
    resetProtectedFieldKeyCacheForTests();
    expect(await revealValue(db, port, { ...kept, aad: 'aad-kept' })).toBe('kept');
  });

  it('refuses a provider that cannot re-wrap, and a scope for another job', async () => {
    await expect(rewrapDataKeys(db, scope(), localOnly)).rejects.toThrow('cannot re-wrap');
    const wrong = systemScopeForTest('process-erasure') as unknown as ReturnType<typeof scope>;
    await expect(rewrapDataKeys(db, wrong, kmsPort({ legacy: true }))).rejects.toThrow('wrong job');
  });

  it('says it is unavailable, rather than failing, before the migration has run', async () => {
    await db.execute(sql`alter table data_keys drop column wrapping_key_id`);
    const summary = await rewrapDataKeys(db, scope(), kmsPort({ legacy: true }));
    expect(summary.available).toBe(false);
  });

  it('keeps protecting and reading values before the column exists, even inside a transaction (a deploy ahead of its migration)', async () => {
    await db.execute(sql`alter table data_keys drop column wrapping_key_id`);
    // The first write per key version inserts the data key, and runs inside a transaction in
    // real use: neither the insert nor the read may touch the missing column.
    const value = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const written = await protectValue(txDb, localOnly, 'before migration', 'aad');
      resetProtectedFieldKeyCacheForTests();
      expect(await revealValue(txDb, localOnly, { ...written, aad: 'aad' })).toBe(
        'before migration',
      );
      return written;
    });
    resetProtectedFieldKeyCacheForTests();
    expect(await revealValue(db, localOnly, { ...value, aad: 'aad' })).toBe('before migration');
  });

  it('seals and reveals an invitation link with the key service, including the key that wrapped it', async () => {
    const port = kmsPort({ legacy: false });
    const { queueInvitationEmail, revealInvitationLink } = await import('./invitation-email');
    const generated = await port.generateDataKey();
    expect(generated.wrappingKeyId).toBe('fake-kms:key-1');
    // The sealed link carries the wrapping key id so opening it later never guesses.
    const token = 'A'.repeat(43);
    const recorder = { ...port, generateDataKey: async () => generated };
    await db.transaction(async (tx) => {
      await queueInvitationEmail(tx as unknown as Db, {
        kind: 'team',
        invitationId: 'inv-1',
        email: 'invitee@example.com',
        rawToken: token,
        encryption: recorder,
      });
    });
    const [row] = await db.select().from(schema.notifications);
    const sealed = (
      row?.payload as { sealedInvitationLink: Parameters<typeof revealInvitationLink>[0] }
    ).sealedInvitationLink;
    expect(sealed.wrappingKeyId).toBe('fake-kms:key-1');
    expect(await revealInvitationLink(sealed, 'team', 'inv-1', port)).toBe(
      `/invitation?kind=team&token=${token}`,
    );
  });
});
