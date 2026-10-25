/**
 * Whether anyone with a confirmed email address may create an account (the public beta).
 *
 * Off unless `PUBLIC_BETA_OPEN` is exactly `true` AND Neon Auth, the only sign-in system, is
 * configured (the same address and secret checks sign-in applies), so the site never invites
 * sign-ups it cannot serve. Neon Auth refuses unconfirmed addresses before any account exists.
 * This opens account creation only: it does not turn on real-applicant data, payments or
 * commercial claims, which have their own gates (capabilities.ts, commercial-readiness.ts).
 */
export function isPublicBetaOpen(
  read: (name: string) => string | undefined = (name) => process.env[name],
): boolean {
  if (read('PUBLIC_BETA_OPEN')?.trim() !== 'true') return false;
  const baseUrl = read('NEON_AUTH_BASE_URL')?.trim() ?? '';
  const secret = read('NEON_AUTH_COOKIE_SECRET') ?? '';
  return baseUrl.startsWith('https://') && secret.length >= 32;
}
