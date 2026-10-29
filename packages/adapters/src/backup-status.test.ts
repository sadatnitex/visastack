import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_FRESHNESS_MAX_AGE_MS, hasRecentDatabaseBackup } from './backup-status';

const { send, destroy } = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));
vi.mock('@aws-sdk/client-s3', async (load) => ({
  ...(await load<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class {
    send = send;
    destroy = destroy;
  },
}));
const input = {
  endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,
  accessKeyId: 'test',
  secretAccessKey: 'test',
  now: Date.parse('2026-10-10T00:00:00Z'),
};
function body(changes: Record<string, unknown> = {}) {
  const text = JSON.stringify({
    version: 1,
    scope: 'database-only',
    objectKey: 'database/2026-10-09-1.sql.vsbk',
    sha256: 'a'.repeat(64),
    size: 200,
    completedAt: '2026-10-09T00:00:00Z',
    ...changes,
  });
  return { Body: Readable.from([Buffer.from(text)]), ContentLength: Buffer.byteLength(text) };
}
beforeEach(() => {
  send.mockReset();
  destroy.mockReset();
});
describe('backup completion status', () => {
  it('requires a fresh manifest and an existing archive with the expected size', async () => {
    send.mockResolvedValueOnce(body()).mockResolvedValueOnce({ ContentLength: 200 });
    expect(await hasRecentDatabaseBackup(input)).toBe(true);
    expect(send.mock.calls[1]?.[0].input.Key).toBe('database/2026-10-09-1.sql.vsbk');
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('refuses stale, future, wrong-prefix and incomplete evidence', async () => {
    for (const changes of [
      { completedAt: '2026-09-01' },
      { completedAt: '2027-01-01' },
      { objectKey: 'documents/clean/secret' },
      { sha256: '' },
    ]) {
      send.mockResolvedValueOnce(body(changes));
      expect(await hasRecentDatabaseBackup(input)).toBe(false);
    }
    send.mockResolvedValueOnce(body()).mockResolvedValueOnce({ ContentLength: 1 });
    expect(await hasRecentDatabaseBackup(input)).toBe(false);
  });
  it('accepts a capture up to 36 hours old and refuses an older one, now that captures run daily', async () => {
    expect(BACKUP_FRESHNESS_MAX_AGE_MS).toBe(36 * 60 * 60 * 1000);
    const at = (hoursAgo: number) => new Date(input.now - hoursAgo * 60 * 60 * 1000).toISOString();
    send.mockResolvedValueOnce(body({ completedAt: at(35.9) })).mockResolvedValueOnce({
      ContentLength: 200,
    });
    expect(await hasRecentDatabaseBackup(input)).toBe(true);
    for (const hoursAgo of [36, 48, 6 * 24]) {
      send.mockResolvedValueOnce(body({ completedAt: at(hoursAgo) }));
      expect(await hasRecentDatabaseBackup(input)).toBe(false);
    }
  });
  it('distinguishes missing backup from provider access failure', async () => {
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await hasRecentDatabaseBackup(input)).toBe(false);
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 403 } });
    await expect(hasRecentDatabaseBackup(input)).rejects.toThrow('unavailable');
  });
});
