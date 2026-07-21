import 'server-only';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Platform-admin allowlist. `ADMIN_EMAILS` is a comma-separated list of the
 * email addresses permitted to run compliance actions (retention policies,
 * legal holds) and to verify organizations. Matching is case-insensitive and
 * whitespace-tolerant. With no allowlist configured, nobody is an admin
 * (fail-closed).
 */
export function isPlatformAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  const raw = readEnv('ADMIN_EMAILS');
  if (!raw) return false;
  const target = email.trim().toLowerCase();
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
    .includes(target);
}
