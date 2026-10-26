import 'server-only';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * `ADMIN_EMAILS` - a comma-separated allowlist - is no longer the authority
 * for platform-admin access (master directive §7 "PR 5"; see
 * `@visastack/services`'s `hasAnyPlatformRole`/`isPlatformOwner`, the real
 * accountable, auditable, revocable role model). This is now purely a
 * one-time bootstrap seed: it only grants anything while the
 * `platform_roles` table has never had a single grant, so the very first
 * platform owner can create real role rows (including their own) - after
 * that, this list is never consulted again, even if left configured.
 * Matching and whitespace handling unchanged from the original allowlist.
 */
export function bootstrapAdminEmails(): readonly string[] {
  const raw = readEnv('ADMIN_EMAILS');
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}
