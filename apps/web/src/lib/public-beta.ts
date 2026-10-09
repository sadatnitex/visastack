import { selectedIdentityProvider } from './identity-selection';

/**
 * Whether anyone with a confirmed email address may create an account (the public beta).
 *
 * Off unless `PUBLIC_BETA_OPEN` is exactly `true`, and only ever on with Neon Auth sign-in, which
 * refuses unconfirmed addresses before any account exists. With WorkOS the invitation list
 * stays in force whatever this is set to. This opens account creation only: it does not turn on
 * real-applicant data, payments or commercial claims, which have their own gates
 * (capabilities.ts, commercial-readiness.ts).
 */
export function isPublicBetaOpen(
  read: (name: string) => string | undefined = (name) => process.env[name],
): boolean {
  return (
    read('PUBLIC_BETA_OPEN')?.trim() === 'true' && selectedIdentityProvider(read) === 'neon_auth'
  );
}
