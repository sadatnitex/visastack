import 'server-only';
import { type Db, hasAnyPlatformRole, isPlatformOwner } from '@visastack/services';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * `ADMIN_EMAILS` — a comma-separated allowlist — is no longer the authority
 * for platform-admin access (master directive §7 "PR 5"; see
 * `@visastack/services`'s `hasAnyPlatformRole`/`isPlatformOwner`, the real
 * accountable, auditable, revocable role model). This is now purely a
 * one-time bootstrap seed: it only grants anything while the
 * `platform_roles` table has never had a single grant, so the very first
 * platform owner can create real role rows (including their own) — after
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

/** True if the signed-in account holds any active platform role (or bootstrap applies). */
export async function isPlatformAdmin(
  db: Db,
  ctx: { readonly accountId: string; readonly email: string },
): Promise<boolean> {
  return hasAnyPlatformRole(db, { ...ctx, bootstrapEmails: bootstrapAdminEmails() });
}

/** True if the signed-in account is a platform owner (or bootstrap applies) — required to manage roles. */
export async function isPlatformOwnerAccount(
  db: Db,
  ctx: { readonly accountId: string; readonly email: string },
): Promise<boolean> {
  return isPlatformOwner(db, { ...ctx, bootstrapEmails: bootstrapAdminEmails() });
}
