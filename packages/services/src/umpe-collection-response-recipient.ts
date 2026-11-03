import { eq } from 'drizzle-orm';
import { GuestCollectionSessionProof } from './access/guest-collection';
import { type Db, first, schema } from './db';
import { guestSessionLink } from './umpe-guest-collection';

/**
 * The one place a traveller's answer learns which request it answers (UMPE P7): from the request
 * desk session the browser holds (P8), the link, its request, issued revision, agency and the
 * address the link was emailed to. Built on P8's own `guestSessionLink`, so a session reads live
 * here exactly when it does on the desk (session live; link not revoked, replaced or expired;
 * request sent; agency open; issuer still an admin). The account path needs no guest code: who
 * answers is proven by the signed-in account, never by the session.
 */
export interface CollectionResponseRecipient {
  readonly linkId: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly revisionId: string;
  /** The address this link was emailed to, or null for a copied link (which binds to nobody). */
  readonly emailHint: string | null;
  readonly destination: string;
  readonly purpose: string | null;
  readonly dueAt: Date | null;
  readonly expiresAt: Date;
}

/** The recipient context of a live desk session, or null for everything else, all alike. */
export async function collectionResponseRecipient(
  db: Db,
  session: GuestCollectionSessionProof,
  now: Date,
): Promise<CollectionResponseRecipient | null> {
  if (!GuestCollectionSessionProof.isGenuine(session)) return null;
  // The account path acts for a signed-in person: their longer idle window (UMPE P9).
  const live = await guestSessionLink(db, session, now, { signedIn: true });
  if (!live) return null;
  const links = schema.agencyCollectionLinks;
  const requests = schema.agencyCollectionRequests;
  const row = first(
    await db
      .select({
        revisionId: links.revisionId,
        emailHint: links.recipientEmailHint,
        expiresAt: links.expiresAt,
        requestId: requests.id,
        organizationId: requests.organizationId,
        destination: requests.destination,
        purpose: requests.purpose,
        dueAt: requests.dueAt,
      })
      .from(links)
      .innerJoin(requests, eq(requests.id, links.requestId))
      .where(eq(links.id, live.linkId))
      .limit(1),
  );
  if (!row) return null;
  return { linkId: live.linkId, ...row };
}
