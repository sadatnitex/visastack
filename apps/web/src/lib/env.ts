import 'server-only';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
export function readEnv(name: string): string | undefined {
  return process.env[name];
}

export function isPresent(name: string): boolean {
  const value = readEnv(name);
  return typeof value === 'string' && value.length > 0;
}

const WORKOS_ENV_VARS = ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'WORKOS_COOKIE_PASSWORD'] as const;

/**
 * The one canonical definition of "is WorkOS configured to sign anyone in."
 * Lives here (not capabilities.ts, which used to own it) so both
 * capabilities.ts and commercial-readiness.ts can depend on it without a
 * circular import between them.
 */
export function isWorkosConfigured(): boolean {
  return WORKOS_ENV_VARS.every(isPresent) && isPresent('NEXT_PUBLIC_WORKOS_REDIRECT_URI');
}
