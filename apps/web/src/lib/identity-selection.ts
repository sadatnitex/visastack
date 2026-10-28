/**
 * Which pages need a signed-in Neon Auth session. Kept free of imports so the request filter
 * (middleware) can read it without pulling in sign-in code.
 */

/** Neon Auth owns these pages; everything else stays public or is handled by its own rules. */
// The AI app consent screen needs a signed-in person too; sign-in returns them to it.
const NEON_PROTECTED = /^\/(app|pilot-access-denied|oauth\/authorize)(\/|$)/;

/**
 * Whether the Neon sign-in check must run for this path. The landing page, status page, trust
 * pages and the sign-in and sign-up pages themselves stay public. The CSP middleware passes a
 * path Next has already normalised.
 */
export function isNeonProtectedPath(pathname: string): boolean {
  return NEON_PROTECTED.test(pathname);
}
