import { and, eq } from 'drizzle-orm';
import { CollectionLinkProof } from './access/collection-scope';
import { type Db, first, schema } from './db';
import { openCollectionLink } from './umpe-collection-request-service';

/**
 * The one place a traveller's answer learns which request it answers (UMPE P7): from a request
 * link the browser holds, the request, its issued revision, the agency and the address the link was
 * emailed to. Built on P6's own `openCollectionLink`, so a link reads open here exactly when it
 * reads open there (not revoked, replaced or expired; request sent; agency open; issuer still an
 * admin). When the link moves to a request-scoped session (P8), only this adapter changes.
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

/** The recipient context of an open link, or null for every link that is not open, all alike. */
export async function collectionResponseRecipient(
  db: Db,
  link: CollectionLinkProof,
  now: Date,
): Promise<CollectionResponseRecipient | null> {
  if (!CollectionLinkProof.isGenuine(link)) return null;
  const open = await openCollectionLink(db, link, now);
  if (!open) return null;
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
      .where(and(eq(links.id, open.linkId), eq(links.tokenHash, link.tokenHash)))
      .limit(1),
  );
  if (!row) return null;
  return { linkId: open.linkId, ...row };
}
