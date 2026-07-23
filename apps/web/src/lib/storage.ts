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
 * Neon-bytea keeps local development, automated tests, and PR previews
 * working with zero external accounts (the directive's own §3 taxonomy
 * classifies pull-request previews as "development" mode, alongside local
 * dev and tests) — that path is REDUCED-CONTROL and NON-COMMERCIAL (bytes
 * live in the application database, not a purpose-built object store).
 *
 * FAIL CLOSED in production (`VERCEL_ENV === 'production'`): the controlled
 * pilot handling real evidence must never silently degrade to reduced-control
 * storage just because the token wasn't configured — that's a deployment
 * misconfiguration, not something to paper over (§10/§21E: "fail closed when
 * only reduced-control mode available").
 */
export function createStorage(db: Db): StoragePort & BlobStore {
  const signingSecret = readEnv('BLOB_SIGNING_SECRET');
  if (!signingSecret) throw new Error('BLOB_SIGNING_SECRET is not configured');
  const baseUrl = resolveBaseUrl();

  const blobToken = readEnv('BLOB_READ_WRITE_TOKEN');
  if (blobToken) {
    return new VercelPrivateBlobStorage({ db, signingSecret, baseUrl, token: blobToken });
  }

  if (readEnv('VERCEL_ENV') === 'production') {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not configured in production — refusing to fall back to reduced-control Neon-bytea storage for real evidence',
    );
  }
  return new NeonBlobStorage({ db, signingSecret, baseUrl });
}
