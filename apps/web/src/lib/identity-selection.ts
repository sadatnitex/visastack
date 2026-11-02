/**
 * Which pages need a signed-in Neon Auth session. Kept free of imports so the request filter
 * (middleware) can read it without pulling in sign-in code.
 */

/** Neon Auth owns these pages; everything else stays public or is handled by its own rules. */
// The AI app consent screen needs a signed-in person too; sign-in returns them to it.
// The password re-check page (/auth/reauth) is for a signed-in person only, and the filter must
// renew their session cookie before the page is drawn (a page cannot set cookies), S18 section R.
// The other /auth pages (sign-in, sign-up, password reset) stay public.
// UMPE P7: answering an agency request from your own record (/collect/account) needs a signed-in
// person; the filter sends anyone else to sign in (or create an account) and back to the same
// request. The rest of /collect (the link's own landing) stays public.
const NEON_PROTECTED =
  /^\/(app|pilot-access-denied|oauth\/authorize|auth\/reauth|collect\/account)(\/|$)/;

/**
 * Whether the Neon sign-in check must run for this path. The landing page, status page, trust
 * pages and the sign-in and sign-up pages themselves stay public. The CSP middleware passes a
 * path Next has already normalised.
 */
export function isNeonProtectedPath(pathname: string): boolean {
  return NEON_PROTECTED.test(pathname);
}
