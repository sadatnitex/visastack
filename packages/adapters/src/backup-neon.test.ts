import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDatabaseBackup } from './backup-neon';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  send: vi.fn(),
  abort: vi.fn(),
  archived: [] as Buffer[],
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@aws-sdk/client-s3', async (load) => ({
  ...(await load<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class {
    send = mocks.send;
  },
}));
vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {
    private body: AsyncIterable<Buffer>;
    constructor(options: { params: { Body: AsyncIterable<Buffer> } }) {
      this.body = options.params.Body;
    }
    async done() {
      for await (const chunk of this.body) mocks.archived.push(Buffer.from(chunk));
    }
    abort = mocks.abort;
  },
}));

const values: Record<string, string> = {
  GITHUB_REF: 'refs/heads/main',
  GITHUB_RUN_ID: '1',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: 'a'.repeat(40),
  BACKUP_DATABASE_URL: 'postgresql://backup:test@ep-backup.us-east-1.aws.neon.tech/neondb', // supply-chain-allow: synthetic nonexistent hostname; subprocess and S3 are mocked, no network calls.
  BACKUP_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
  BACKUP_ENCRYPTION_KEY_ID: 'backup-v1',
  R2_ENDPOINT_URL: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,
  R2_ACCESS_KEY_ID: 'test',
  R2_SECRET_ACCESS_KEY: 'test',
};
const original = new Map(Object.keys(values).map((name) => [name, process.env[name]]));
beforeEach(() => {
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
  mocks.spawn.mockReset();
  mocks.send.mockReset();
  mocks.abort.mockReset();
  mocks.abort.mockResolvedValue(undefined);
  mocks.archived.length = 0;
});
afterEach(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function dump(code: number) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() => {
      child.stdout.end('CREATE TABLE synthetic (id integer);');
      child.emit('close', code);
    });
    return child;
  });
  return child;
}

describe('pg_dump backup commit boundary', () => {
  it('records completion only after successful pg_dump and encrypted upload', async () => {
    dump(0);
    await runDatabaseBackup();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    const manifest = JSON.parse(mocks.send.mock.calls[0]?.[0].input.Body);
    expect(manifest).toMatchObject({
      scope: 'database-only',
      restoreVerified: false,
      keyId: 'backup-v1',
    });
    expect(Buffer.concat(mocks.archived).includes('CREATE TABLE')).toBe(false);
    expect(manifest.size).toBe(Buffer.concat(mocks.archived).length);
    const args = mocks.spawn.mock.calls[0];
    expect(args?.[0]).toBe('pg_dump');
    expect(args?.[1].join(' ')).not.toContain('postgresql://');
    expect(args?.[2].env.PGSSLMODE).toBe('verify-full');
    expect(args?.[2].env.PGHOST).not.toContain('pooler');
  });
  it('never commits a success manifest after a failed or partial dump', async () => {
    const child = dump(1);
    await expect(runDatabaseBackup()).rejects.toThrow('no success manifest');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('rejects preview execution and pooled URLs before launching any process', async () => {
    const ref = 'GITHUB_REF';
    process.env[ref] = 'refs/heads/preview';
    await expect(runDatabaseBackup()).rejects.toThrow('main');
    process.env[ref] = 'refs/heads/main';
    const uri = 'BACKUP_DATABASE_URL';
    process.env[uri] = values[uri]?.replace('ep-backup.', 'ep-backup-pooler.');
    await expect(runDatabaseBackup()).rejects.toThrow('direct Neon');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
