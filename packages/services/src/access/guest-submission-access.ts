import { and, eq, sql } from 'drizzle-orm';
import { type Db, first, schema } from '../db';
import { isUuid } from '../lifecycle/foundation/ids';
import { agencyCollectionRequestsEnabled } from '../umpe-collection-request-switch';
import { agencyMayReceiveAnswers } from './collection-response-access';

/**
 * Gate-side helpers for guest submissions (UMPE P9). A guest submission names no person: it is an
 * immutable list of exact files a guest sent to one agency request. These helpers read only ids and
 * states, never a file or a name, so the notification worker can ask them at send time.
 */

/**
 * Whether the P9 tables exist yet. Code goes live before its migration runs, so a missing table
 * means "no guest files", which is exact because none can have been written. `to_regclass` never
 * raises, so an outer transaction is never disturbed. Nothing is cached.
 */
export async function guestUploadsPresent(db: Db): Promise<boolean> {
  const row = first(
    await db
      .select({
        present: sql<boolean>`to_regclass('agency_collection_guest_files') is not null and to_regclass('agency_collection_guest_submissions') is not null and to_regclass('agency_collection_guest_submission_items') is not null and to_regclass('agency_collection_reviews') is not null and to_regclass('agency_collection_guest_holds') is not null`,
      })
      .from(sql`(select 1) as probe`),
  );
  return row?.present === true;
}

/**
 * A guest submission the agency may still reach: its request was not revoked. A closed request
 * stays readable until the guest's chosen retention ends and the purge removes it. Built at call
 * time, never at module load.
 */
export function liveGuestSubmission(): ReturnType<typeof sql> {
  const submissions = schema.agencyCollectionGuestSubmissions;
  return sql`exists (select 1 from agency_collection_requests r where r.id = ${submissions.requestId} and r.organization_id = ${submissions.organizationId} and r.status <> 'REVOKED')`;
}

/**
 * Whether a guest submission is still live for its agency, for the notification worker's send-time
 * check of a "Submitted to Agency" notice (the same event a signed-in answer queues): the switch is
 * on, it exists for that agency, its request is not revoked and the agency is still reviewed.
 */
export async function guestSubmissionStillLive(
  db: Db,
  submissionId: string,
  organizationId: string,
): Promise<boolean> {
  if (!agencyCollectionRequestsEnabled()) return false;
  if (!isUuid(submissionId) || !isUuid(organizationId)) return false;
  if (!(await guestUploadsPresent(db))) return false;
  if (!(await agencyMayReceiveAnswers(db, organizationId))) return false;
  const submissions = schema.agencyCollectionGuestSubmissions;
  const row = first(
    await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.id, submissionId),
          eq(submissions.organizationId, organizationId),
          liveGuestSubmission(),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}
