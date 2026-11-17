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

export interface MagicLinkRequest {
  readonly email: string;
  readonly callbackURL: string;
  readonly errorCallbackURL: string;
}

export type MagicLinkSend = (request: MagicLinkRequest) => Promise<{
  readonly error: { readonly status?: unknown; readonly code?: unknown } | null;
}>;

/**
 * Neon Auth's server side sends sign-in links (`sign-in/magic-link` in its endpoint list), but its
 * published types leave the method out. This reads it at run time and types it narrowly; null
 * when it is not there, which the caller treats as a failed send (logged, same answer shown).
 */
export function magicLinkSignIn(auth: unknown): MagicLinkSend | null {
  const signIn = (auth as { signIn?: unknown } | null)?.signIn;
  if (typeof signIn !== 'object' || signIn === null) return null;
  const send = (signIn as { magicLink?: unknown }).magicLink;
  return typeof send === 'function' ? (send.bind(signIn) as MagicLinkSend) : null;
}
