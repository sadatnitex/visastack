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

/**
 * Whether the SELECTED sign-in system has everything it needs. With Neon Auth that is the
 * service address and the cookie secret (the same checks the sign-in code applies); otherwise
 * WorkOS. The selection comes from `IDENTITY_PROVIDER` and defaults to WorkOS.
 */
export function isSignInConfigured(): boolean {
  if (readEnv('IDENTITY_PROVIDER')?.trim() === 'neon_auth') {
    const baseUrl = readEnv('NEON_AUTH_BASE_URL')?.trim() ?? '';
    const secret = readEnv('NEON_AUTH_COOKIE_SECRET') ?? '';
    return baseUrl.startsWith('https://') && secret.length >= 32;
  }
  return isWorkosConfigured();
}
