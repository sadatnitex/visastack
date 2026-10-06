/**
 * Which sign-in system this deployment uses. Kept free of imports so the request filter
 * (middleware) can read it without pulling in either provider's code.
 *
 * `IDENTITY_PROVIDER=neon_auth` selects Neon Auth. Anything else, including unset, keeps WorkOS
 * AuthKit, so a missing or mistyped value can never switch sign-in systems by accident. Unknown
 * values are rejected loudly by `createIdentityPort` (providers.ts).
 */
export type IdentityProviderName = 'workos' | 'neon_auth';

export function selectedIdentityProvider(
  read: (name: string) => string | undefined = (name) => process.env[name],
): IdentityProviderName {
  return read('IDENTITY_PROVIDER')?.trim() === 'neon_auth' ? 'neon_auth' : 'workos';
}

/** Neon Auth owns these pages; everything else stays public or is handled by its own rules. */
const NEON_PROTECTED = /^\/(app|pilot-access-denied)(\/|$)/;

/**
 * Whether the Neon sign-in check must run for this path. The landing page, status page, trust
 * pages and the sign-in and sign-up pages themselves stay public. The CSP middleware passes a
 * path Next has already normalised (see authkit-paths.ts).
 */
export function isNeonProtectedPath(pathname: string): boolean {
  return NEON_PROTECTED.test(pathname);
}
