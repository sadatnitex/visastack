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

/**
 * `MALWARE_SCANNER_PROVIDER=clamav` with a connection to the engine: a socket path, or both a
 * host and a port. The one check the scanner factory (providers.ts `createMalwareScanner`), the
 * capability registry (capabilities.ts) and the readiness gate (commercial-readiness.ts) share,
 * so the three can never disagree about whether the in-process ClamAV engine is configured.
 */
export function isClamAvConfigured(): boolean {
  return (
    readEnv('MALWARE_SCANNER_PROVIDER') === 'clamav' &&
    (isPresent('CLAMAV_SOCKET_PATH') || (isPresent('CLAMAV_HOST') && isPresent('CLAMAV_PORT')))
  );
}

/**
 * The owner's `PDF_UPLOADS` switch (ADR 0024). PDFs are on unless it says off, in any of the
 * usual spellings; one reading for every caller so the form, the routes and the scanner agree.
 */
export function pdfUploadsSwitchedOff(): boolean {
  const value = (readEnv('PDF_UPLOADS') ?? '').trim().toLowerCase();
  return value === 'off' || value === 'false' || value === '0' || value === 'no';
}

/**
 * The owner's `DOCUMENT_REMOVAL_REQUESTS` switch (resource lifecycle lane D, gate G-D). Off unless
 * it says on, in any of the usual spellings: Ask Us to Remove This File, the staff queue and its
 * alerts stay hidden until the owner switches it on.
 */
export function documentRemovalRequestsOn(): boolean {
  const value = (readEnv('DOCUMENT_REMOVAL_REQUESTS') ?? '').trim().toLowerCase();
  return value === 'on' || value === 'true' || value === '1' || value === 'yes';
}
