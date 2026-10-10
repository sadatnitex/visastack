import { NeonBlobStorage, R2Storage, VercelPrivateBlobStorage } from '@visastack/adapters';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Storage backend selection (master directive §10/§21E): Vercel Private Blob
 * when configured; Neon-bytea only for local dev/tests/PR previews (the
 * directive's own §3 taxonomy places PR previews in "development" mode); and
 * a hard fail — never a silent fallback — when production is missing the
 * token, since that would mean real evidence silently landing in
 * reduced-control storage.
 */

const ENV_KEYS = [
  'BLOB_SIGNING_SECRET',
  'BLOB_READ_WRITE_TOKEN',
  'VERCEL_ENV',
  'STORAGE_PROVIDER',
  'R2_ENDPOINT_URL',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;
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

  it('rejects an unrecognized STORAGE_PROVIDER (master directive §7 "PR 11" env contract)', async () => {
    setEnv('STORAGE_PROVIDER', 's3');
    const { createStorage } = await import('./storage');
    expect(() => createStorage({} as never)).toThrow(/unsupported STORAGE_PROVIDER/);
  });

  it('treats STORAGE_PROVIDER="" as unset, matching the standard cp .env.example .env.local workflow (Codex review, PR-E1, round 2)', async () => {
    setEnv('STORAGE_PROVIDER', '');
    const { createStorage } = await import('./storage');
    expect(createStorage({} as never)).toBeInstanceOf(NeonBlobStorage);
  });

  it('accepts STORAGE_PROVIDER=vercel_blob when the token is actually configured', async () => {
    setEnv('STORAGE_PROVIDER', 'vercel_blob');
    setEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_token');
    const { createStorage } = await import('./storage');
    expect(createStorage({} as never)).toBeInstanceOf(VercelPrivateBlobStorage);
  });

  it('rejects STORAGE_PROVIDER=vercel_blob when the token is missing, instead of silently falling back to Neon', async () => {
    setEnv('STORAGE_PROVIDER', 'vercel_blob');
    const { createStorage } = await import('./storage');
    expect(() => createStorage({} as never)).toThrow(/requires BLOB_READ_WRITE_TOKEN/);
  });

  it('rejects STORAGE_PROVIDER=neon on a real deployment, even though the token-absent default would already refuse it', async () => {
    setEnv('VERCEL_ENV', 'production');
    setEnv('STORAGE_PROVIDER', 'neon');
    const { createStorage } = await import('./storage');
    expect(() => createStorage({} as never)).toThrow(/reduced-control storage/);
  });

  it('accepts STORAGE_PROVIDER=neon in local dev / test', async () => {
    setEnv('STORAGE_PROVIDER', 'neon');
    const { createStorage } = await import('./storage');
    expect(createStorage({} as never)).toBeInstanceOf(NeonBlobStorage);
  });
});

describe('R2 storage selection', () => {
  it('requires explicit selection and preserves existing storage credentials', async () => {
    setEnv('R2_ENDPOINT_URL', `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    setEnv('R2_ACCESS_KEY_ID', 'test');
    setEnv('R2_SECRET_ACCESS_KEY', 'test');
    setEnv('BLOB_READ_WRITE_TOKEN', 'test');
    const { createStorage } = await import('./storage');
    expect(createStorage({} as never)).toBeInstanceOf(VercelPrivateBlobStorage);
    setEnv('STORAGE_PROVIDER', 'r2');
    expect(createStorage({} as never)).toBeInstanceOf(R2Storage);
  });
  it('fails closed when R2 credentials or the independent production copy are missing', async () => {
    setEnv('STORAGE_PROVIDER', 'r2');
    unsetEnv('R2_SECRET_ACCESS_KEY');
    const { createStorage } = await import('./storage');
    expect(() => createStorage({} as never)).toThrow('all three');
    setEnv('R2_ENDPOINT_URL', `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    setEnv('R2_ACCESS_KEY_ID', 'test');
    setEnv('R2_SECRET_ACCESS_KEY', 'test');
    setEnv('VERCEL_ENV', 'production');
    expect(() => createStorage({} as never)).toThrow('existing private file store');
  });
});
