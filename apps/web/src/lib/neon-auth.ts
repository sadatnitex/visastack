import 'server-only';
import { type NeonAuth, createNeonAuth } from '@neondatabase/auth/next/server';

/**
 * Neon Auth (managed Better Auth) settings, read from the hosting environment. Names only are
 * documented; values are never logged. `NEON_AUTH_BASE_URL` is shown in the Neon console once
 * Auth is enabled for the project. `NEON_AUTH_COOKIE_SECRET` is a random string of at least 32
 * characters that signs the session cookie.
 */
export interface NeonAuthSettings {
  readonly baseUrl: string;
  readonly cookieSecret: string;
}

export class NeonAuthNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`Neon Auth is not configured: ${reason}`);
    this.name = 'NeonAuthNotConfiguredError';
  }
}

export function readNeonAuthSettings(
  read: (name: string) => string | undefined = (name) => process.env[name],
): NeonAuthSettings {
  const baseUrl = read('NEON_AUTH_BASE_URL')?.trim();
  const cookieSecret = read('NEON_AUTH_COOKIE_SECRET');
  if (!baseUrl) throw new NeonAuthNotConfiguredError('NEON_AUTH_BASE_URL is missing');
  if (!baseUrl.startsWith('https://')) {
    throw new NeonAuthNotConfiguredError('NEON_AUTH_BASE_URL must start with https://');
  }
  if (!cookieSecret) throw new NeonAuthNotConfiguredError('NEON_AUTH_COOKIE_SECRET is missing');
  if (cookieSecret.length < 32) {
    throw new NeonAuthNotConfiguredError('NEON_AUTH_COOKIE_SECRET must be at least 32 characters');
  }
  return { baseUrl, cookieSecret };
}

let cached: NeonAuth | undefined;

/** The one Neon Auth server instance for this process, created on first use. */
export function getNeonAuth(): NeonAuth {
  if (!cached) {
    const { baseUrl, cookieSecret } = readNeonAuthSettings();
    cached = createNeonAuth({ baseUrl, cookies: { secret: cookieSecret } });
  }
  return cached;
}

/** Test seam: forget the cached instance. */
export function resetNeonAuthForTests(): void {
  cached = undefined;
}
