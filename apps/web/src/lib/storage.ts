import 'server-only';
import { NeonBlobStorage } from '@visastack/adapters';
import type { Db } from '@visastack/services';

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
 * Construct the Neon-bytea blob store bound to the current request's DB handle.
 * Throws if the signing secret is not configured (fail-closed): access
 * references must always be signed.
 */
export function createStorage(db: Db): NeonBlobStorage {
  const signingSecret = readEnv('BLOB_SIGNING_SECRET');
  if (!signingSecret) throw new Error('BLOB_SIGNING_SECRET is not configured');
  return new NeonBlobStorage({ db, signingSecret, baseUrl: resolveBaseUrl() });
}
