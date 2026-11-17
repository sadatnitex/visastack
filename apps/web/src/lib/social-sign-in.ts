/**
 * Whether the "Continue with Google" button is offered.
 *
 * Off unless `GOOGLE_SIGN_IN_ENABLED` is exactly `true` AND Neon Auth, the only sign-in system, has
 * a secure address, so the page never shows a button it cannot serve. Switching it on is a
 * deliberate step taken only after the Google sign-in is set up in the Neon Auth settings for this
 * deployment. It changes nothing about who may use the product: the invitation check and the
 * confirmed-email rule still run on every request after sign-in. The cookie secret is not read
 * here (a repository guard allows only the files that sign people in to touch it); if it were
 * missing, the start route would fail and show its fixed message, as email sign-in already does.
 */
export function googleSignInEnabled(
  read: (name: string) => string | undefined = (name) => process.env[name],
): boolean {
  if (read('GOOGLE_SIGN_IN_ENABLED')?.trim() !== 'true') return false;
  return (read('NEON_AUTH_BASE_URL')?.trim() ?? '').startsWith('https://');
}

/** The only addresses the sign-in route may send the browser to: secure web addresses. */
export function safeProviderRedirect(target: unknown): string | null {
  if (typeof target !== 'string') return null;
  try {
    const url = new URL(target);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
