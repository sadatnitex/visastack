/** Only the selected Neon sign-in page on this deployment is an acceptable destination. */
export function isNeonSignInRedirect(location, baseUrl) {
  try {
    const target = new URL(location, baseUrl);
    const base = new URL(baseUrl);
    return (
      target.origin === base.origin &&
      target.pathname === '/auth/sign-in' &&
      target.username === '' &&
      target.password === ''
    );
  } catch {
    return false;
  }
}
