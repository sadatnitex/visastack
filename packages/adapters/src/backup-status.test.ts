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
    completedAt: '2026-10-09T12:00:00Z',
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
  it('accepts a capture under 24 hours old and refuses an older one: one missed daily capture fails the check', async () => {
    expect(BACKUP_FRESHNESS_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    const at = (hoursAgo: number) => new Date(input.now - hoursAgo * 60 * 60 * 1000).toISOString();
    // 11:07 check after a 05:17 capture: about 6 hours old.
    send.mockResolvedValueOnce(body({ completedAt: at(5.8) })).mockResolvedValueOnce({
      ContentLength: 200,
    });
    expect(await hasRecentDatabaseBackup(input)).toBe(true);
    send.mockResolvedValueOnce(body({ completedAt: at(23.9) })).mockResolvedValueOnce({
      ContentLength: 200,
    });
    expect(await hasRecentDatabaseBackup(input)).toBe(true);
    // The morning capture failed: yesterday's is about 30 hours old.
    for (const hoursAgo of [24, 29.8, 48]) {
      send.mockResolvedValueOnce(body({ completedAt: at(hoursAgo) }));
      expect(await hasRecentDatabaseBackup(input)).toBe(false);
    }
  });
  it('allows a few minutes of clock skew but no further into the future', async () => {
    const ahead = (minutes: number) => new Date(input.now + minutes * 60 * 1000).toISOString();
    send.mockResolvedValueOnce(body({ completedAt: ahead(5) })).mockResolvedValueOnce({
      ContentLength: 200,
    });
    expect(await hasRecentDatabaseBackup(input)).toBe(true);
    send.mockResolvedValueOnce(body({ completedAt: ahead(30) }));
    expect(await hasRecentDatabaseBackup(input)).toBe(false);
  });
  it('distinguishes missing backup from provider access failure', async () => {
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await hasRecentDatabaseBackup(input)).toBe(false);
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 403 } });
    await expect(hasRecentDatabaseBackup(input)).rejects.toThrow('unavailable');
  });
});
