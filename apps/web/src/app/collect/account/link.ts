import 'server-only';
import type { GuestCollectionSessionProof } from '@visastack/services';
import { cookies } from 'next/headers';
import { COLLECT_COOKIE, sessionProofFrom } from '../load';

/**
 * The request desk session this browser holds (UMPE P7 on P8's request-scoped session), read only
 * through the `/collect` route's own helpers, never parsed here. The session names exactly one
 * link; it proves nothing about who is answering (the signed-in account does that), and every
 * service re-checks it live.
 */
export async function heldCollectionLink(): Promise<HeldLink | null> {
  const proof = sessionProofFrom((await cookies()).get(COLLECT_COOKIE)?.value);
  return proof ? { proof } : null;
}

/** The desk session proof the services take. */
export interface HeldLink {
  readonly proof: GuestCollectionSessionProof;
}
