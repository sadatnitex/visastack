import 'server-only';

/**
 * How recently the signed-in person typed their password, for Neon Auth sessions. A Neon session
 * is created at sign-in and only extended afterwards, so its creation time is the real sign-in
 * time: signing in again (the re-check page) makes a new session with a fresh creation time.
 * Used by the absolute session limit (session-age.ts) and by step-up (step-up.ts). Anything
 * missing or unreadable counts as stale, so a gap can only ask for MORE sign-ins, never fewer.
 */

interface SessionReader {
  getSession(): Promise<{
    data: { session?: { createdAt?: Date | string | null } | null } | null;
  }>;
}

export async function neonSessionAgeSeconds(
  reader?: SessionReader,
  now: () => number = Date.now,
): Promise<number> {
  const source =
    reader ??
    // One Neon Auth read per page request, shared with the identity check (neon-request-session.ts).
    ((await import('./neon-request-session')).requestSessionReader() as unknown as SessionReader);
  const { data } = await source.getSession();
  const created = data?.session?.createdAt;
  if (!created) return Number.POSITIVE_INFINITY;
  const at = created instanceof Date ? created.getTime() : Date.parse(created);
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now() - at) / 1000);
}

/** A same-site relative path or the app home. Never an off-site address. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/app';
  }
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 32) return '/app';
  }
  return value;
}

export function neonReauthUrl(returnTo: string): string {
  return `/auth/reauth?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`;
}
