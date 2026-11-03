import { and, eq } from 'drizzle-orm';
import {
  type AgencyCollectionScope,
  agencyCollectionScopeProblem,
} from './access/collection-scope';
import { guestAnswerAddress } from './access/guest-correction-notice';
import { type Db, first, schema } from './db';
import { queueGuestCorrectionEmail } from './invitation-email';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';

/**
 * The email a guest gets when the agency asks for a correction (UMPE G3, the gap P9 left open).
 *
 * Queued inside the review's own transaction, so it exists only if the decision does. It goes to
 * the address the request still carries, and only when that is the address the guest proved (its
 * hash matches the answer's recipient key). It names the agency (only an ACTIVE one) and nothing
 * else: no note, no document, no person, no route. The worker checks again at send time.
 *
 * `queued`: on the outbox. `no_address`: the request carries no address, or not the guest's any
 * more. `limited`: too many for this guest of this request this hour (the decision still stands).
 * `missing`: refused, exactly like an answer that does not exist.
 */
export type GuestCorrectionNoticeOutcome = 'queued' | 'no_address' | 'limited' | 'missing';

export async function queueGuestCorrectionNotice(
  tx: Db,
  scope: AgencyCollectionScope,
  input: { readonly reviewId: string; readonly submissionId: string },
  now: Date = new Date(),
): Promise<GuestCorrectionNoticeOutcome> {
  if (agencyCollectionScopeProblem(scope)) return 'missing';
  const submissions = schema.agencyCollectionGuestSubmissions;
  const links = schema.agencyCollectionLinks;
  const requests = schema.agencyCollectionRequests;
  const row = first(
    await tx
      .select({
        requestId: submissions.requestId,
        recipientKey: submissions.recipientKey,
        linkHint: links.recipientEmailHint,
        requestHint: requests.recipientEmailHint,
        orgName: schema.organizations.name,
        orgStatus: schema.organizations.status,
      })
      .from(submissions)
      .innerJoin(
        links,
        and(eq(links.id, submissions.linkId), eq(links.requestId, submissions.requestId)),
      )
      .innerJoin(
        requests,
        and(
          eq(requests.id, submissions.requestId),
          eq(requests.organizationId, scope.organizationId),
        ),
      )
      .innerJoin(schema.organizations, eq(schema.organizations.id, submissions.organizationId))
      .where(
        and(
          eq(submissions.id, input.submissionId),
          eq(submissions.organizationId, scope.organizationId),
        ),
      )
      .limit(1),
  );
  if (!row) return 'missing';
  const address = guestAnswerAddress(row.linkHint, row.requestHint, row.recipientKey);
  if (!address) return 'no_address';
  const decision = await checkRateLimit(
    tx,
    {
      subjectId: `${row.requestId}:${row.recipientKey}`,
      action: 'collection_guest_correction.email',
      label: 'email',
    },
    RATE_LIMITS.COLLECTION_GUEST_CORRECTION_EMAIL,
    now,
  );
  if (!decision.allowed) return 'limited';
  await queueGuestCorrectionEmail(tx, scope, {
    reviewId: input.reviewId,
    email: address,
    agencyName: row.orgStatus === 'ACTIVE' ? row.orgName : null,
  });
  return 'queued';
}
