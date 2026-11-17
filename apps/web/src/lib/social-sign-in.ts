/**
 * Whether the "Continue with Google" button is offered.
 *
 * Off unless `GOOGLE_SIGN_IN_ENABLED` is exactly `true` AND Neon Auth, the only sign-in system, is
 * configured (the same address and secret checks sign-in applies), so the page never shows a
 * button it cannot serve. Switching it on is a deliberate step taken only after the Google
 * sign-in is set up in the Neon Auth settings for this deployment. It changes nothing about who
 * may use the product: the invitation check and the confirmed-email rule still run on every
 * request after sign-in.
 */
export function googleSignInEnabled(
  read: (name: string) => string | undefined = (name) => process.env[name],
): boolean {
  if (read('GOOGLE_SIGN_IN_ENABLED')?.trim() !== 'true') return false;
  const baseUrl = read('NEON_AUTH_BASE_URL')?.trim() ?? '';
  const secret = read('NEON_AUTH_COOKIE_SECRET') ?? '';
  return baseUrl.startsWith('https://') && secret.length >= 32;
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
