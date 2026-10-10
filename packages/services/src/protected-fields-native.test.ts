import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './db';
import type { KeyManagementPort } from './ports';
import { protectValue, resetProtectedFieldKeyCacheForTests, revealValue } from './protected-fields';

const variable = 'PROTECTED_FIELDS_PGCRYPTO';
const before = process.env[variable];
afterEach(() => {
  if (before === undefined) delete process.env[variable];
  else process.env[variable] = before;
  resetProtectedFieldKeyCacheForTests();
});

function fixture() {
  const key = Buffer.alloc(32, 7);
  const port: KeyManagementPort = {
    currentKeyVersion: () => 'native-test-v1',
    generateDataKey: async () => {
      throw new Error('existing key expected');
    },
    unwrapDataKey: async () => key,
  };
  const query = {
    from: () => query,
    where: () => query,
    limit: async () => [{ wrappedDataKey: Buffer.from('wrapped') }],
  };
  // Mock only PostgreSQL's PGP layer. Node's real GCM and AAD authentication
  // remain exercised. A separate read-only Neon probe verifies real pgcrypto.
  const dialect = new PgDialect();
  const execute = vi.fn(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    const bytes = Buffer.from(compiled.params[0] as string, 'hex');
    const result = compiled.sql.includes('pgp_sym_encrypt_bytea')
      ? Buffer.concat([Buffer.from('pgp:'), bytes])
      : bytes.subarray(4);
    return { rows: [{ payload: result.toString('hex') }] };
  });
  const db = { select: () => query, execute } as unknown as Db;
  return { db, port, execute, dialect };
}

describe('native protected-field envelope compatibility', () => {
  it('parameterizes native SQL, sends no applicant plaintext, and reads both formats after rollback', async () => {
    const { db, port, execute, dialect } = fixture();
    delete process.env[variable];
    const legacy = await protectValue(db, port, 'X1234567', 'applicant:one');
    process.env[variable] = 'required';
    const native = await protectValue(db, port, 'X1234567', 'applicant:one');
    expect(native.nonce).toHaveLength(13);
    expect(legacy.nonce).toHaveLength(12);
    const statement = dialect.sqlToQuery(execute.mock.calls[0]?.[0]);
    expect(statement.sql).toContain('pgp_sym_encrypt_bytea');
    expect(statement.params.some((value) => String(value).includes('X1234567'))).toBe(false);
    delete process.env[variable];
    expect(await revealValue(db, port, { ...native, aad: 'applicant:one' })).toBe('X1234567');
    expect(await revealValue(db, port, { ...legacy, aad: 'applicant:one' })).toBe('X1234567');
    await expect(revealValue(db, port, { ...native, aad: 'applicant:other' })).rejects.toThrow();
  });
  it('fails closed on missing pgcrypto without leaking query parameters', async () => {
    const { db, port, execute } = fixture();
    process.env[variable] = 'required';
    execute.mockRejectedValue(new Error('query failed; params: private-key'));
    await expect(protectValue(db, port, 'passport secret', 'aad')).rejects.toThrow(
      'native protected-field encryption failed',
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown encryption formats and modified inner ciphertext', async () => {
    const { db, port } = fixture();
    process.env[variable] = 'required';
    const native = await protectValue(db, port, 'secret', 'aad');
    const changed = Buffer.from(native.ciphertext);
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    await expect(
      revealValue(db, port, { ...native, ciphertext: changed, aad: 'aad' }),
    ).rejects.toThrow();
    await expect(
      revealValue(db, port, { ...native, nonce: new Uint8Array(14), aad: 'aad' }),
    ).rejects.toThrow('unsupported');
  });
});
