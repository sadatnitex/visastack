import 'server-only';
import { NeonBlobStorage, VercelPrivateBlobStorage } from '@visastack/adapters';
import type { BlobStore, Db, StoragePort } from '@visastack/services';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * The canonical production origin used to mint signed blob URLs. Falls back to
 * the Vercel-provided URL, then to the registered redirect origin — never a
 * local address.
 */
function resolveBaseUrl(): string {
  const explicit = readEnv('NEXT_PUBLIC_APP_URL');
  if (explicit) return explicit;
  const vercel = readEnv('VERCEL_PROJECT_PRODUCTION_URL');
  if (vercel) return `https://${vercel}`;
  const redirect = readEnv('NEXT_PUBLIC_WORKOS_REDIRECT_URI');
  if (redirect) return new URL(redirect).origin;
  return 'https://visastack-five.vercel.app';
}

/**
 * Construct the active storage backend bound to the current request's DB
 * handle (master directive §10/§21E).
 *
 * Vercel Private Blob is selected whenever `BLOB_READ_WRITE_TOKEN` is
 * configured — the pilot/commercial-track backend. Falling back to
 * Neon-bytea keeps local development and tests working with zero external
 * accounts, but that path is REDUCED-CONTROL and NON-COMMERCIAL (bytes live
 * in the application database, not a purpose-built object store) — it must
 * never be the active backend for a real deployment handling real evidence.
 *
 * Fail-closed either way: access references must always be signed.
 */
export function createStorage(db: Db): StoragePort & BlobStore {
  const signingSecret = readEnv('BLOB_SIGNING_SECRET');
  if (!signingSecret) throw new Error('BLOB_SIGNING_SECRET is not configured');
  const baseUrl = resolveBaseUrl();

  const blobToken = readEnv('BLOB_READ_WRITE_TOKEN');
  if (blobToken) {
    return new VercelPrivateBlobStorage({ db, signingSecret, baseUrl, token: blobToken });
  }
  return new NeonBlobStorage({ db, signingSecret, baseUrl });
}
