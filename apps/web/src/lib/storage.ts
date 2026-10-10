import 'server-only';
import { NeonBlobStorage, R2Storage, VercelPrivateBlobStorage } from '@visastack/adapters';
import type { BlobStore, Db, StoragePort } from '@visastack/services';
import { resolveBaseUrl } from './base-url';
import { isRealDeployment } from './deployment-mode';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
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
 * FAIL CLOSED on any real deployment (`isRealDeployment()` — controlled
 * pilot or commercial, per the deployment-mode registry): handling real
 * evidence must never silently degrade to reduced-control storage just
 * because the token wasn't configured — that's a deployment
 * misconfiguration, not something to paper over (§10/§21E: "fail closed when
 * only reduced-control mode available").
 */
export function createStorage(db: Db): StoragePort & BlobStore {
  const signingSecret = readEnv('BLOB_SIGNING_SECRET');
  if (!signingSecret) throw new Error('BLOB_SIGNING_SECRET is not configured');
  const baseUrl = resolveBaseUrl();
  const blobToken = readEnv('BLOB_READ_WRITE_TOKEN');

  // STORAGE_PROVIDER (master directive §7 "PR 11" env contract) is an
  // optional, explicit cross-check on top of the token-presence selection
  // below, not a second selection mechanism — an operator who sets it to a
  // value inconsistent with the actual token configuration gets a loud
  // misconfiguration error instead of silently landing on whichever backend
  // the token happened to select. A blank string is treated the same as
  // unset (Codex review, PR-E1, round 2): the documented
  // `cp .env.example .env.local` workflow sets `STORAGE_PROVIDER=''`, not
  // undefined — `./providers`'s `checkKnownProvider` normalizes the same
  // case for its own `*_PROVIDER` vars, but this is an independent check
  // (there is no `StoragePort`-constructing factory in `providers.ts` to
  // route through), so it needs the identical fix on its own. Without this,
  // `/api/health/ready` reports `ready` (via `validateProviderEnv()`, fixed
  // above) while the very first upload still throws here — readiness
  // lying about a genuinely broken deployment is exactly what this whole
  // route exists to prevent.
  const rawProvider = readEnv('STORAGE_PROVIDER');
  const provider = rawProvider === '' ? undefined : rawProvider;
  if (provider === 'r2') {
    const endpoint = readEnv('R2_ENDPOINT_URL');
    const accessKeyId = readEnv('R2_ACCESS_KEY_ID');
    const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY');
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('STORAGE_PROVIDER=r2 requires all three R2 environment variables');
    }
    if (isRealDeployment() && !blobToken)
      throw new Error(
        'R2 mirrored storage requires the existing private file store on a real deployment',
      );
    const legacy = blobToken
      ? new VercelPrivateBlobStorage({ db, signingSecret, baseUrl, token: blobToken })
      : new NeonBlobStorage({ db, signingSecret, baseUrl });
    return new R2Storage({
      db,
      signingSecret,
      baseUrl,
      endpoint,
      accessKeyId,
      secretAccessKey,
      legacy,
    });
  }
  if (provider !== undefined && provider !== 'vercel_blob' && provider !== 'neon') {
    throw new Error(
      `unsupported STORAGE_PROVIDER=${JSON.stringify(provider)} — this deployment implements: vercel_blob, neon`,
    );
  }
  if (provider === 'vercel_blob' && !blobToken) {
    throw new Error('STORAGE_PROVIDER=vercel_blob requires BLOB_READ_WRITE_TOKEN to be configured');
  }
  if (provider === 'neon' && isRealDeployment()) {
    throw new Error(
      'STORAGE_PROVIDER=neon is reduced-control storage and is not permitted on a real deployment',
    );
  }

  if (blobToken) {
    return new VercelPrivateBlobStorage({ db, signingSecret, baseUrl, token: blobToken });
  }

  if (isRealDeployment()) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not configured on this deployment — refusing to fall back to reduced-control Neon-bytea storage for real evidence',
    );
  }
  return new NeonBlobStorage({ db, signingSecret, baseUrl });
}
