import 'server-only';
import { type CollectionLinkProof, collectionLinkProof } from '@visastack/services';
import { cookies } from 'next/headers';
import { COLLECT_COOKIE, parseCookie } from '../load';

/**
 * The request link this browser holds (UMPE P7), read only through the `/collect` route's own
 * cookie helpers, never parsed here. The cookie lives on `/collect` and is bound to its link, so
 * the answer page sees exactly the link the person opened, and nothing when they opened none.
 * When the link moves to a request-scoped session (P8), this is the one place that changes.
 */
export async function heldCollectionLink(): Promise<HeldLink | null> {
  const held = parseCookie((await cookies()).get(COLLECT_COOKIE)?.value);
  const proof = held ? collectionLinkProof(held.token) : null;
  return held && proof ? { proof, linkId: held.linkId } : null;
}

/** The link proof and the link id the cookie was bound to (a different open link reads closed). */
export interface HeldLink {
  readonly proof: CollectionLinkProof;
  readonly linkId: string;
}
