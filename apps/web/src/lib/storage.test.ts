import { NeonBlobStorage, VercelPrivateBlobStorage } from '@visastack/adapters';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Storage backend selection (master directive §10/§21E): Vercel Private Blob
 * when configured; Neon-bytea only for local dev/tests/PR previews (the
 * directive's own §3 taxonomy places PR previews in "development" mode); and
 * a hard fail — never a silent fallback — when production is missing the
 * token, since that would mean real evidence silently landing in
 * reduced-control storage.
 */

const ENV_KEYS = ['BLOB_SIGNING_SECRET', 'BLOB_READ_WRITE_TOKEN', 'VERCEL_ENV'] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL[key] = process.env[key];
  setEnv('BLOB_SIGNING_SECRET', 'test-secret');
  unsetEnv('BLOB_READ_WRITE_TOKEN');
  unsetEnv('VERCEL_ENV');
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL[key];
    if (original === undefined) unsetEnv(key);
    else setEnv(key, original);
  }
});

describe('createStorage — backend selection', () => {
  it('throws when BLOB_SIGNING_SECRET is not configured', async () => {
    unsetEnv('BLOB_SIGNING_SECRET');
    const { createStorage } = await import('./storage');
    expect(() => createStorage({} as never)).toThrow(/BLOB_SIGNING_SECRET/);
  });

  it('selects VercelPrivateBlobStorage when BLOB_READ_WRITE_TOKEN is present', async () => {
    setEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_token');
    const { createStorage } = await import('./storage');
    const storage = createStorage({} as never);
    expect(storage).toBeInstanceOf(VercelPrivateBlobStorage);
  });

  it('falls back to NeonBlobStorage in local dev / test (no VERCEL_ENV)', async () => {
    const { createStorage } = await import('./storage');
    const storage = createStorage({} as never);
    expect(storage).toBeInstanceOf(NeonBlobStorage);
  });

  it('falls back to NeonBlobStorage on a PR preview deployment (VERCEL_ENV=preview)', async () => {
    setEnv('VERCEL_ENV', 'preview');
    const { createStorage } = await import('./storage');
    const storage = createStorage({} as never);
    expect(storage).toBeInstanceOf(NeonBlobStorage);
  });

  it('fails closed in production when BLOB_READ_WRITE_TOKEN is absent, never falling back silently', async () => {
    setEnv('VERCEL_ENV', 'production');
    const { createStorage } = await import('./storage');
    expect(() => createStorage({} as never)).toThrow(/refusing to fall back/);
  });
});
