import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptBackup } from './backup-encryption';
import { runDatabaseRestoreDrill, validateRecoveryManifest } from './database-restore-drill';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  send: vi.fn(),
  destroy: vi.fn(),
  boundary: 't',
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@aws-sdk/client-s3', async (load) => ({
  ...(await load<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class {
    send = mocks.send;
    destroy = mocks.destroy;
  },
}));
const keyId = 'synthetic-v1';
const makeManifest = () => ({
  version: 1,
  scope: 'database-only',
  restoreVerified: false,
  objectKey: 'database/2026-10-11T05-49-54-633Z-123-1.sql.vsbk',
  sha256: 'a'.repeat(64),
  size: 256,
  keyId,
  completedAt: '2026-10-11T05:49:54.633Z',
  codeSha: 'b'.repeat(40),
  runId: '123',
});
const values: Record<string, string> = {
  GITHUB_REF: 'refs/heads/main',
  BACKUP_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
  BACKUP_ENCRYPTION_KEY_ID: keyId,
  R2_ENDPOINT_URL: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,
  R2_ACCESS_KEY_ID: 'test',
  R2_SECRET_ACCESS_KEY: 'test',
  PGHOST: 'production-must-not-be-inherited',
  PGPASSWORD: 'must-not-be-inherited',
};
let stdout: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  vi.stubEnv('GITHUB_STEP_SUMMARY', '');
  mocks.boundary = 't';
  mocks.spawn.mockReset();
  mocks.send.mockReset();
  mocks.destroy.mockReset();
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  mocks.spawn.mockImplementation(() => {
    const stdin = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    let sql = '';
    stdin.on('data', (chunk) => {
      sql += chunk.toString();
    });
    stdin.on('end', () => {
      child.stdout.end(
        sql.includes('current_database()')
          ? `${mocks.boundary}\n`
          : sql.includes('count(*)')
            ? '6\n'
            : sql.includes('pgp_sym_decrypt')
              ? 't\n'
              : '',
      );
      child.stderr.end();
      child.emit('close', 0);
    });
    return child;
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  stdout.mockRestore();
});

describe('recovery commit-marker validation', () => {
  it('accepts a completed database-only backup', () => {
    expect(validateRecoveryManifest(makeManifest(), keyId).runId).toBe('123');
  });
  it.each([
    { objectKey: 'documents/private-file' },
    { objectKey: 'database/../secret.sql.vsbk' },
    { sha256: 'invalid' },
    { size: 6 * 1024 ** 3 },
    { size: -1 },
    { keyId: 'different-key' },
    { scope: 'all-data' },
    { codeSha: 'bad' },
    { completedAt: 'invalid' },
    { completedAt: '2099-01-01T00:00:00Z' },
  ])('rejects invalid or unsafe manifest %j', (change) => {
    expect(() => validateRecoveryManifest({ ...makeManifest(), ...change }, keyId)).toThrow();
  });
});

async function configureArchive(tamper = false, hashMismatch = false) {
  const encrypted = encryptBackup(
    Readable.from(['CREATE TABLE synthetic_fixture(id integer);']),
    Buffer.alloc(32, 7),
    keyId,
  );
  const chunks: Buffer[] = [];
  for await (const chunk of encrypted.stream) chunks.push(Buffer.from(chunk));
  await encrypted.done;
  const archive = Buffer.concat(chunks);
  if (tamper) archive[archive.length - 1] = (archive[archive.length - 1] ?? 0) ^ 1;
  const manifest = {
    ...makeManifest(),
    size: archive.length,
    sha256: hashMismatch ? '0'.repeat(64) : createHash('sha256').update(archive).digest('hex'),
  };
  const json = Buffer.from(JSON.stringify(manifest));
  mocks.send.mockResolvedValueOnce({ Body: Readable.from([json]), ContentLength: json.length });
  mocks.send.mockResolvedValueOnce({
    Body: Readable.from([archive]),
    ContentLength: archive.length,
  });
}

describe('isolated authenticated restore boundary', () => {
  it('restores only authenticated SQL into a fixed restricted sandbox', async () => {
    await configureArchive();
    await runDatabaseRestoreDrill();
    expect(mocks.spawn).toHaveBeenCalledTimes(4);
    for (const call of mocks.spawn.mock.calls) {
      expect(call[0]).toBe('psql');
      expect(call[2].env).toMatchObject({
        PGHOST: 'recovery-postgres',
        PGDATABASE: 'vs_recovery',
        PGUSER: 'vs_restore',
      });
      expect(call[2].env).not.toHaveProperty('PGPASSWORD');
      expect(call[2].env).not.toHaveProperty('R2_SECRET_ACCESS_KEY');
      expect(call[2].env).not.toHaveProperty('BACKUP_ENCRYPTION_KEY_BASE64');
    }
    const report = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(report.databaseRestoreVerified).toBe(true);
    expect(report.fullDisasterRecoveryVerified).toBe(false);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it.each([
    [true, false],
    [false, true],
  ])('never executes SQL from a tampered archive (%s, %s)', async (tamper, badHash) => {
    await configureArchive(tamper, badHash);
    await expect(runDatabaseRestoreDrill()).rejects.toThrow();
    expect(mocks.spawn).toHaveBeenCalledTimes(1); // Sandbox boundary query only.
    expect(stdout).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it('rejects an unsafe recovery role before downloading the backup', async () => {
    mocks.boundary = 'f';
    await expect(runDatabaseRestoreDrill()).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });
  it('rejects a branch workflow before downloading or connecting', async () => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/preview');
    await expect(runDatabaseRestoreDrill()).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
