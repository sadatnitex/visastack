import 'server-only';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
export function readEnv(name: string): string | undefined {
  return process.env[name];
}

export function isPresent(name: string): boolean {
  const value = readEnv(name);
  return typeof value === 'string' && value.length > 0;
}

/** The Neon Auth settings sign-in needs; also listed (presence only) in admin readiness. */
export const NEON_AUTH_ENV_VARS = ['NEON_AUTH_BASE_URL', 'NEON_AUTH_COOKIE_SECRET'] as const;

/**
 * Whether Neon Auth, the only sign-in system, has everything it needs: the service address and
 * the cookie secret (the same checks the sign-in code applies). Lives here so capabilities.ts,
 * readiness.ts and commercial-readiness.ts can depend on it without a circular import.
 */
export function isSignInConfigured(): boolean {
  const baseUrl = readEnv('NEON_AUTH_BASE_URL')?.trim() ?? '';
  const secret = readEnv('NEON_AUTH_COOKIE_SECRET') ?? '';
  return baseUrl.startsWith('https://') && secret.length >= 32;
}
