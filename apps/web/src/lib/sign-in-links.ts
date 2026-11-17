/**
 * Sign in with an email link (Q8, owner decision 17 Nov 2026), using the link sign-in Neon Auth
 * already offers. Off unless `SIGN_IN_LINKS` is exactly "on" (after trimming, any case), so
 * deploying this changes nothing until the owner switches it on.
 */
export function signInLinksEnabled(
  read: (name: string) => string | undefined = (name) => process.env[name],
): boolean {
  return read('SIGN_IN_LINKS')?.trim().toLowerCase() === 'on';
}
