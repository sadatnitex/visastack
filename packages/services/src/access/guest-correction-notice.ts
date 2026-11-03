import { and, eq, gt, sql } from 'drizzle-orm';
import { type Db, first, schema } from '../db';
import { isUuid } from '../lifecycle/foundation/ids';
import { agencyCollectionRequestsEnabled } from '../umpe-collection-request-switch';
import { guestRecipientKey } from '../umpe-guest-collection';
import { agencyMayReceiveAnswers } from './collection-response-access';
import { collectionIssuerMayIssue } from './collection-scope';
import { guestUploadsPresent } from './guest-submission-access';

/**
 * Gate-side helpers for the email that tells a guest their agency asked for a correction (UMPE G3,
 * closing the P9 gap). They read ids, states and the request's own address only, never a file,
 * a note or a name, so the notification worker can ask them at send time.
 */

/**
 * The address a guest answer came from, when the request still carries it: the link's address, or
 * else the request's (a copied link inherits the request's, as on the guest desk), and only while
 * it still hashes to the guest who submitted. Null otherwise: a changed address is never emailed.
 */
export function guestAnswerAddress(
  linkEmailHint: string | null,
  requestEmailHint: string | null,
  recipientKey: string,
): string | null {
  const address = linkEmailHint ?? requestEmailHint;
  if (!address) return null;
  return guestRecipientKey(address) === recipientKey ? address.trim().toLowerCase() : null;
}

/**
 * Whether a queued correction email may still go now: the decision it reports is a Needs
 * Correction on a guest answer of this agency and nothing newer was decided on that answer; the
 * link the guest used is still open (not revoked, replaced or expired) and its issuer may still
 * issue; the request is still sent; the agency is still reviewed (ACTIVE); and the request still
 * carries the address the email goes to. Any other state, or a malformed record, is false.
 */
export async function guestCorrectionStillDeliverable(
  db: Db,
  notification: {
    readonly resourceId: string | null;
    readonly organizationId: string | null;
    readonly recipientEmail: string | null;
  },
  now: Date = new Date(),
): Promise<boolean> {
  const { resourceId: reviewId, organizationId, recipientEmail } = notification;
  if (!agencyCollectionRequestsEnabled()) return false;
  if (!reviewId || !organizationId || !recipientEmail) return false;
  if (!isUuid(reviewId) || !isUuid(organizationId)) return false;
  if (!(await guestUploadsPresent(db))) return false;
  if (!(await agencyMayReceiveAnswers(db, organizationId))) return false;
  const reviews = schema.agencyCollectionReviews;
  const submissions = schema.agencyCollectionGuestSubmissions;
  const links = schema.agencyCollectionLinks;
  const requests = schema.agencyCollectionRequests;
  const row = first(
    await db
      .select({
        submissionId: submissions.id,
        recipientKey: submissions.recipientKey,
        decidedAt: reviews.decidedAt,
        linkHint: links.recipientEmailHint,
        requestHint: requests.recipientEmailHint,
        createdBy: links.createdByAccountId,
      })
      .from(reviews)
      .innerJoin(
        submissions,
        and(
          eq(submissions.id, reviews.guestSubmissionId),
          eq(submissions.organizationId, reviews.organizationId),
        ),
      )
      .innerJoin(
        links,
        and(eq(links.id, submissions.linkId), eq(links.requestId, submissions.requestId)),
      )
      .innerJoin(
        requests,
        and(
          eq(requests.id, submissions.requestId),
          eq(requests.organizationId, reviews.organizationId),
        ),
      )
      .where(
        and(
          eq(reviews.id, reviewId),
          eq(reviews.organizationId, organizationId),
          eq(reviews.source, 'guest'),
          eq(reviews.decision, 'NEEDS_CORRECTION'),
          eq(requests.status, 'SENT'),
          sql`${links.revokedAt} is null`,
          sql`${links.replacedById} is null`,
          gt(links.expiresAt, now),
        ),
      )
      .limit(1),
  );
  if (!row) return false;
  // A later decision on the same answer (Accepted, say) makes this email stale.
  const newer = first(
    await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(
        and(
          eq(reviews.organizationId, organizationId),
          eq(reviews.guestSubmissionId, row.submissionId),
          gt(reviews.decidedAt, row.decidedAt),
        ),
      )
      .limit(1),
  );
  if (newer) return false;
  if (!(await collectionIssuerMayIssue(db, row.createdBy, organizationId))) return false;
  const address = guestAnswerAddress(row.linkHint, row.requestHint, row.recipientKey);
  return address !== null && address === recipientEmail.trim().toLowerCase();
}
