import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { guestUploadsPresent } from './access/guest-submission-access';
import { SystemScope } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import type { BlobStore } from './storage';

/**
 * Retention for guest answers (UMPE P9, owner decision 2 November): after a request closes, the
 * agency keeps a guest's files only for the period the guest chose when they submitted (3 to 180
 * days; the longest of their submissions counts). Then the daily job removes the bytes and every
 * row of that guest for that request: files, submissions, their lines and review decisions. A
 * guest who never submitted chose nothing, so their files go as soon as the request closes. An
 * active legal hold on the request keeps everything, whatever was chosen.
 *
 * "Closed" is the request's own end (Closed or Revoked, from when it ended) or, for a request
 * still Sent, the moment its last link ran out when no link is open any more.
 *
 * The same run removes desk sessions (and their codes) that can never be used again: those of a
 * link that is no longer open, a day after they ended. Sessions of an open link stay, so the
 * link's lifetime code limits keep counting (P8).
 */

export const GUEST_PURGE_BATCH = 20;
/** A run stops starting new guests after this long, so the daily job keeps time for its other work. */
export const GUEST_PURGE_BUDGET_MS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_KEEP_AFTER_END_MS = DAY_MS;
const SESSION_PURGE_BATCH = 500;

export interface GuestPurgeResult {
  /** Guests (one request, one address) whose files and answers were removed. */
  readonly guestsPurged: number;
  readonly filesPurged: number;
  readonly submissionsPurged: number;
  /** Guests due but kept by an active legal hold. */
  readonly held: number;
  readonly sessionsPurged: number;
  readonly failed: number;
}

const NOTHING: GuestPurgeResult = {
  guestsPurged: 0,
  filesPurged: 0,
  submissionsPurged: 0,
  held: 0,
  sessionsPurged: 0,
  failed: 0,
};

/** When a request closed (`r` is the request), in SQL, or null while it is open. */
function closedAtSql(now: Date) {
  return sql`(case
    when r.status in ('CLOSED', 'REVOKED') then r.updated_at
    when r.status = 'SENT' and not exists (
      select 1 from agency_collection_links ol
      where ol.request_id = r.id and ol.revoked_at is null and ol.replaced_by_id is null and ol.expires_at > ${now}
    ) then (select max(ml.expires_at) from agency_collection_links ml where ml.request_id = r.id)
    else null end)`;
}

interface DueGuest {
  readonly requestId: string;
  readonly recipientKey: string;
}

/** The SQL that picks the guests whose retention has ended at `now` (`g` the guest, `r` the request). */
function dueSql(now: Date) {
  const closedAt = closedAtSql(now);
  return sql`${closedAt} is not null and ${closedAt} + make_interval(days => coalesce((select max(s.retention_days) from agency_collection_guest_submissions s where s.request_id = g.request_id and s.recipient_key = g.recipient_key), 0)) <= ${now}`;
}

/** Built at call time, never at module load. */
const heldSql = () =>
  sql`exists (select 1 from agency_collection_guest_holds h where h.request_id = g.request_id and h.released_at is null)`;
const guestsSql = () =>
  sql`(select request_id, recipient_key from agency_collection_guest_files union select request_id, recipient_key from agency_collection_guest_submissions) as g join agency_collection_requests r on r.id = g.request_id`;

/**
 * Due guests at `now` that no hold keeps, bounded. Held guests are left out here (and counted on
 * their own), so a pile of long holds can never fill every batch and starve everyone else.
 */
async function dueGuests(db: Db, now: Date, limit: number): Promise<DueGuest[]> {
  const rows = await db
    .select({ requestId: sql<string>`g.request_id`, recipientKey: sql<string>`g.recipient_key` })
    .from(guestsSql())
    .where(sql`${dueSql(now)} and not ${heldSql()}`)
    .orderBy(sql`g.request_id`, sql`g.recipient_key`)
    .limit(limit);
  return rows.map((r) => ({
    requestId: String(r.requestId),
    recipientKey: String(r.recipientKey),
  }));
}

/** How many due guests a legal hold keeps right now. */
async function heldGuests(db: Db, now: Date): Promise<number> {
  const row = first(
    await db
      .select({ held: sql<number>`count(*)::int` })
      .from(guestsSql())
      .where(sql`${dueSql(now)} and ${heldSql()}`),
  );
  return Number(row?.held ?? 0);
}

/**
 * Remove one guest's files and answers for one request, under the request row lock that placing a
 * hold also takes, so a hold placed meanwhile wins. Bytes go first: a row never outlives its
 * bytes' removal for long, and a failure leaves rows for the next run to finish.
 */
async function purgeGuest(
  db: Db,
  storage: Pick<BlobStore, 'deleteObject'>,
  guest: DueGuest,
): Promise<{ files: number; submissions: number } | 'held'> {
  return db.transaction(async (tx) => {
    const request = first(
      await tx
        .select({
          id: schema.agencyCollectionRequests.id,
          organizationId: schema.agencyCollectionRequests.organizationId,
        })
        .from(schema.agencyCollectionRequests)
        .where(eq(schema.agencyCollectionRequests.id, guest.requestId))
        .limit(1)
        .for('update'),
    );
    if (!request) return { files: 0, submissions: 0 };
    const hold = first(
      await tx
        .select({ id: schema.agencyCollectionGuestHolds.id })
        .from(schema.agencyCollectionGuestHolds)
        .where(
          and(
            eq(schema.agencyCollectionGuestHolds.requestId, guest.requestId),
            isNull(schema.agencyCollectionGuestHolds.releasedAt),
          ),
        )
        .limit(1),
    );
    if (hold) return 'held';
    const files = schema.agencyCollectionGuestFiles;
    const own = and(
      eq(files.requestId, guest.requestId),
      eq(files.recipientKey, guest.recipientKey),
    );
    const fileRows = await tx
      .select({ id: files.id, objectKey: files.objectKey })
      .from(files)
      .where(own);
    for (const file of fileRows) await storage.deleteObject('QUARANTINE', file.objectKey);
    if (fileRows.length > 0) {
      // The bytes are gone: their registrations go with them.
      await tx.delete(schema.storageObjects).where(
        inArray(
          schema.storageObjects.objectKey,
          fileRows.map((f) => f.objectKey),
        ),
      );
    }
    // Only this transaction may delete submissions directly (the table refuses anyone else).
    await tx.execute(sql`select set_config('visastack.guest_purge', 'on', true)`);
    const submissions = await tx
      .delete(schema.agencyCollectionGuestSubmissions)
      .where(
        and(
          eq(schema.agencyCollectionGuestSubmissions.requestId, guest.requestId),
          eq(schema.agencyCollectionGuestSubmissions.recipientKey, guest.recipientKey),
        ),
      )
      .returning({ id: schema.agencyCollectionGuestSubmissions.id });
    await tx.execute(sql`select set_config('visastack.guest_purge', 'off', true)`);
    if (fileRows.length > 0) {
      await tx.delete(files).where(
        and(
          own,
          inArray(
            files.id,
            fileRows.map((f) => f.id),
          ),
        ),
      );
    }
    // The retention choice of a link whose request has no guest files left goes too.
    const left = first(
      await tx
        .select({ id: files.id })
        .from(files)
        .where(eq(files.requestId, guest.requestId))
        .limit(1),
    );
    if (!left) {
      await tx
        .delete(schema.agencyCollectionGuestDrafts)
        .where(eq(schema.agencyCollectionGuestDrafts.requestId, guest.requestId));
    }
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_GUEST_PURGED',
      actorAccountId: null,
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'agency_collection_request',
      resourceId: guest.requestId,
      metadata: {
        organizationId: request.organizationId,
        files: fileRows.length,
        submissions: submissions.length,
      },
    });
    return { files: fileRows.length, submissions: submissions.length };
  });
}

/** Remove desk sessions (codes go with them) that can never be used again. */
async function purgeDeadSessions(db: Db, now: Date): Promise<number> {
  const before = new Date(now.getTime() - SESSION_KEEP_AFTER_END_MS);
  const sessions = schema.agencyCollectionGuestSessions;
  const removed = await db
    .delete(sessions)
    .where(
      sql`${sessions.id} in (
        select s.id from agency_collection_guest_sessions s
        join agency_collection_links l on l.id = s.link_id
        join agency_collection_requests r on r.id = l.request_id
        where (s.expires_at < ${before} or s.revoked_at < ${before})
          and (l.revoked_at is not null or l.replaced_by_id is not null or l.expires_at < ${now} or r.status <> 'SENT')
        limit ${SESSION_PURGE_BATCH}
      )`,
    )
    .returning({ id: sessions.id });
  return removed.length;
}

/**
 * The daily retention pass for guest answers. Bounded per run; safe to re-run. Nothing happens
 * before the migration runs. A guest whose removal fails is counted and retried next run.
 */
export async function purgeGuestCollectionData(
  db: Db,
  storage: Pick<BlobStore, 'deleteObject'>,
  scope: SystemScope<'process-erasure'>,
  now: Date = new Date(),
  options: {
    readonly limit?: number;
    /** How long this run may keep starting new guests; the clock is read only for this. */
    readonly budgetMs?: number;
    readonly clock?: () => number;
  } = {},
): Promise<GuestPurgeResult> {
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-erasure') return NOTHING;
  if (!(await guestUploadsPresent(db))) return NOTHING;
  const clock = options.clock ?? Date.now;
  const stopAt = clock() + (options.budgetMs ?? GUEST_PURGE_BUDGET_MS);
  const due = await dueGuests(db, now, Math.min(options.limit ?? GUEST_PURGE_BATCH, 500));
  let held = await heldGuests(db, now);
  let guestsPurged = 0;
  let filesPurged = 0;
  let submissionsPurged = 0;
  let failed = 0;
  for (const guest of due) {
    // The rest wait for the next run; nothing is half done, each guest is all or nothing.
    if (clock() >= stopAt) break;
    try {
      const outcome = await purgeGuest(db, storage, guest);
      if (outcome === 'held') {
        held++;
        continue;
      }
      guestsPurged++;
      filesPurged += outcome.files;
      submissionsPurged += outcome.submissions;
    } catch {
      failed++;
    }
  }
  let sessionsPurged = 0;
  try {
    sessionsPurged = await purgeDeadSessions(db, now);
  } catch {
    failed++;
  }
  return { guestsPurged, filesPurged, submissionsPurged, held, sessionsPurged, failed };
}
