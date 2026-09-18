import 'server-only';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * The canonical production origin for any absolute URL this app mints
 * (signed blob URLs, invitation links). Falls back to the Vercel-provided
 * URL, then to the registered redirect origin, never a local address.
 * Extracted from `storage.ts`'s own original copy once a second caller
 * (`invitations.ts`) needed the identical resolution logic.
 */
export function resolveBaseUrl(): string {
  const explicit = readEnv('NEXT_PUBLIC_APP_URL');
  if (explicit) return explicit;
  const vercel = readEnv('VERCEL_PROJECT_PRODUCTION_URL');
  if (vercel) return `https://${vercel}`;
  const redirect = readEnv('NEXT_PUBLIC_WORKOS_REDIRECT_URI');
  if (redirect) return new URL(redirect).origin;
  return 'https://visastack-five.vercel.app';
}
