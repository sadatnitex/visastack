/**
 * The kinds of invitation the public page serves, and the one signed-in page each is reviewed and
 * accepted on. One table for the return address after signing in, every review link and the
 * switch-account action, so the kinds can never point at different places.
 */
export type InvitationKind = 'team' | 'client' | 'sharing';

/** Each entry is an `href`, written out in full, so the route check sees every accept page. */
const ACCEPT_PAGES: Readonly<Record<InvitationKind, { readonly href: string }>> = {
  team: { href: '/app/invitations/accept' },
  client: { href: '/app/client-invitations/accept' },
  sharing: { href: '/app/sharing-invitations/accept' },
};

export function isInvitationKind(kind: unknown): kind is InvitationKind {
  return kind === 'team' || kind === 'client' || kind === 'sharing';
}

/** The review page of this kind, for this link. */
export function invitationAcceptHref(kind: InvitationKind, token: string): string {
  return `${ACCEPT_PAGES[kind].href}?token=${token}`;
}

/** The same address, encoded for a `next=` return after signing in or creating an account. */
export function invitationReturnPath(kind: InvitationKind, token: string): string {
  return encodeURIComponent(invitationAcceptHref(kind, token));
}
