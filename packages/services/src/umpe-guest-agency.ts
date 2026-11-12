import { createHash } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { agencyMayReceiveAnswers } from './access/collection-response-access';
import {
  type AgencyCollectionScope,
  agencyCollectionScopeProblem,
} from './access/collection-scope';
import { guestUploadsPresent, liveGuestSubmission } from './access/guest-submission-access';
import { StepUpProof } from './access/step-up-proof';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, keyedError } from './errors';
import { isUuid } from './lifecycle/foundation/ids';
import type { BlobStore } from './storage';
import { type CollectionItem, parseItems } from './umpe-collection-request-items';
import type {
  CollectionResponseItemView,
  CollectionResponseVersion,
} from './umpe-collection-response-service';
import {
  type GuestSubmissionContentLine,
  guestSubmissionContentSha256,
} from './umpe-guest-uploads';

/**
 * What an agency sees of guest submissions (UMPE P9), in the same review queue as signed-in answers
 * (P7): per issued item, exactly the files the guest sent, by name, or Still Missing. Only an
 * agency VisaStack has reviewed (ACTIVE) sees them, as for signed-in answers, and only its own
 * active owners and admins (the scope). A revoked request shows nothing. A file downloads only
 * after a fresh sign-in (`guestFileStepUp`), only if it is still exactly the bytes sent (SHA-256),
 * and every read is audited with counts. A guest is never named: the agency sees which submission
 * it is, never a profile.
 */

function missing(): ServiceError {
  return keyedError('not_found', 'umpe_guest_agency.no_such_submission');
}

export interface GuestSubmissionView {
  readonly id: string;
  readonly source: 'guest';
  /** Received, never Reviewed: the review decision is separate. */
  readonly status: 'SUBMITTED_TO_AGENCY';
  readonly submissionNo: number;
  readonly revisionNo: number;
  readonly submittedAt: Date;
  readonly retentionDays: number;
  readonly consentVersion: string;
  /** Which guest: the same number for every submission of one guest of this request. */
  readonly guestNo: number;
  readonly intact: boolean;
  readonly lines: readonly CollectionResponseItemView[];
}

/** The newest guest submissions one request lists at once. */
export const GUEST_SUBMISSION_LIST_LIMIT = 50;

type SubmissionRow = typeof schema.agencyCollectionGuestSubmissions.$inferSelect;
type ItemRow = typeof schema.agencyCollectionGuestSubmissionItems.$inferSelect;

function contentLine(row: ItemRow): GuestSubmissionContentLine {
  return {
    itemId: row.itemId,
    kind: row.kind === 'FILE' ? 'FILE' : 'MISSING',
    fileId: row.fileId,
    fileSha256: row.fileSha256,
  };
}

function intactSubmission(row: SubmissionRow, lines: readonly ItemRow[]): boolean {
  return (
    guestSubmissionContentSha256({
      requestId: row.requestId,
      revisionId: row.revisionId,
      recipientKey: row.recipientKey,
      submissionNo: row.submissionNo,
      retentionDays: row.retentionDays,
      consentVersion: row.consentVersion,
      lines: lines.map(contentLine),
    }) === row.contentSha256
  );
}

/** Whether this scope may see guest submissions of this request at all. */
async function agencyMaySee(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
): Promise<boolean> {
  if (agencyCollectionScopeProblem(scope)) return false;
  if (!isUuid(requestId) || !(await guestUploadsPresent(db))) return false;
  return agencyMayReceiveAnswers(db, scope.organizationId);
}

/**
 * Every live guest submission to this agency's request, newest first, each with exactly the files
 * it holds. None for any refusal. Audited once per listing, with counts.
 */
export async function listGuestSubmissions(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
): Promise<GuestSubmissionView[]> {
  if (agencyCollectionScopeProblem(scope)) return [];
  if (!(await agencyMaySee(db, scope, requestId))) return [];
  const submissions = schema.agencyCollectionGuestSubmissions;
  const rows = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.organizationId, scope.organizationId),
        eq(submissions.requestId, requestId),
        liveGuestSubmission(),
      ),
    )
    .orderBy(desc(submissions.submittedAt), desc(submissions.submissionNo), desc(submissions.id))
    .limit(GUEST_SUBMISSION_LIST_LIMIT);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const lines = await db
    .select()
    .from(schema.agencyCollectionGuestSubmissionItems)
    .where(inArray(schema.agencyCollectionGuestSubmissionItems.submissionId, ids));
  const fileIds = [...new Set(lines.flatMap((l) => (l.fileId ? [l.fileId] : [])))];
  const files = new Map(
    (fileIds.length === 0
      ? []
      : await db
          .select({
            id: schema.agencyCollectionGuestFiles.id,
            sizeBytes: schema.agencyCollectionGuestFiles.sizeBytes,
            virusScanned: schema.agencyCollectionGuestFiles.virusScanned,
          })
          .from(schema.agencyCollectionGuestFiles)
          .where(
            and(
              inArray(schema.agencyCollectionGuestFiles.id, fileIds),
              eq(schema.agencyCollectionGuestFiles.organizationId, scope.organizationId),
              eq(schema.agencyCollectionGuestFiles.requestId, requestId),
            ),
          )
    ).map((f) => [f.id, f] as const),
  );
  const revisionIds = [...new Set(rows.map((r) => r.revisionId))];
  const revisions = new Map(
    (
      await db
        .select({
          id: schema.agencyCollectionRequestRevisions.id,
          items: schema.agencyCollectionRequestRevisions.items,
        })
        .from(schema.agencyCollectionRequestRevisions)
        .where(
          and(
            inArray(schema.agencyCollectionRequestRevisions.id, revisionIds),
            eq(schema.agencyCollectionRequestRevisions.requestId, requestId),
          ),
        )
    ).map((r) => [r.id, parseItems(r.items)] as const),
  );
  // Guests are numbered by their first submission to this request (all of them, not only the rows
  // listed here), so a guest keeps the same number from page to page.
  const firsts = await db
    .select({
      recipientKey: submissions.recipientKey,
      first: sql<Date>`min(${submissions.submittedAt})`,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.organizationId, scope.organizationId),
        eq(submissions.requestId, requestId),
      ),
    )
    .groupBy(submissions.recipientKey)
    .orderBy(sql`min(${submissions.submittedAt})`, submissions.recipientKey);
  const order = new Map(firsts.map((row, index) => [row.recipientKey, index + 1] as const));
  const guestNo = (key: string) => order.get(key) ?? 0;

  const views = rows.map((row): GuestSubmissionView => {
    const own = lines.filter((l) => l.submissionId === row.id);
    const items = revisions.get(row.revisionId) ?? null;
    const intact = items !== null && intactSubmission(row, own);
    return {
      id: row.id,
      source: 'guest',
      status: 'SUBMITTED_TO_AGENCY',
      submissionNo: row.submissionNo,
      revisionNo: row.revisionNo,
      submittedAt: row.submittedAt,
      retentionDays: row.retentionDays,
      consentVersion: row.consentVersion,
      guestNo: guestNo(row.recipientKey),
      intact,
      lines: intact && items ? guestLines(items, own, files) : [],
    };
  });
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_GUEST_SUBMISSIONS_READ',
      actorAccountId: scope.accountId,
      actorRole: 'org:collection_response',
      action: 'VIEW_METADATA',
      method: 'API',
      result: 'ALLOWED',
      resourceType: 'agency_collection_request',
      resourceId: requestId,
      metadata: {
        organizationId: scope.organizationId,
        submissions: views.length,
        files: lines.filter((l) => l.kind === 'FILE').length,
      },
    });
  });
  return views;
}

function guestLines(
  items: readonly CollectionItem[],
  own: readonly ItemRow[],
  files: ReadonlyMap<string, { sizeBytes: number; virusScanned: boolean }>,
): CollectionResponseItemView[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const mine = own.filter((l) => l.itemId === item.id);
      const versions: CollectionResponseVersion[] = mine.flatMap(
        (l): CollectionResponseVersion[] => {
          const file = l.fileId ? files.get(l.fileId) : undefined;
          return l.kind === 'FILE' && l.fileId && file
            ? [
                {
                  kind: 'GUEST_FILE',
                  fileId: l.fileId,
                  title: l.title ?? 'Document',
                  sizeBytes: file.sizeBytes,
                  virusScanned: file.virusScanned,
                },
              ]
            : [];
        },
      );
      return {
        itemId: item.id,
        item,
        source: 'guest' as const,
        versions,
        missing: mine.length === 0 || mine.every((l) => l.kind === 'MISSING'),
      };
    });
}

/** The identity check that opens one guest file: bound to the admin and the file. */
export function guestFileStepUp(input: {
  readonly accountId: string;
  readonly fileId: string;
}): {
  readonly accountId: string;
  readonly action: 'DOWNLOAD_ORIGINAL';
  readonly resourceId: string;
} {
  return { accountId: input.accountId, action: 'DOWNLOAD_ORIGINAL', resourceId: input.fileId };
}

export interface GuestFileDownload {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly filename: string;
}

/**
 * The original bytes of one file a live guest submission of this agency holds, after a fresh
 * sign-in of this admin for this file. Refused (as not found, or step-up required) for anything
 * else: another agency, a revoked request, a changed submission, a file it does not list, a file
 * whose bytes no longer match what was sent. Every attempt is audited.
 */
export async function downloadGuestSubmissionFile(
  db: Db,
  storage: Pick<BlobStore, 'getObject'>,
  scope: AgencyCollectionScope,
  input: {
    readonly submissionId: string;
    readonly fileId: string;
    readonly stepUp?: StepUpProof;
  },
): Promise<Result<GuestFileDownload, ServiceError>> {
  if (agencyCollectionScopeProblem(scope)) return err(missing());
  if (!isUuid(input.submissionId) || !isUuid(input.fileId)) return err(missing());
  if (!(await guestUploadsPresent(db))) return err(missing());
  if (!(await agencyMayReceiveAnswers(db, scope.organizationId))) return err(missing());
  const submissions = schema.agencyCollectionGuestSubmissions;
  const submission = first(
    await db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.id, input.submissionId),
          eq(submissions.organizationId, scope.organizationId),
          liveGuestSubmission(),
        ),
      )
      .limit(1),
  );
  if (!submission) return err(missing());
  const lines = await db
    .select()
    .from(schema.agencyCollectionGuestSubmissionItems)
    .where(eq(schema.agencyCollectionGuestSubmissionItems.submissionId, submission.id));
  const line = lines.find((l) => l.kind === 'FILE' && l.fileId === input.fileId);
  const audit = async (result: 'ALLOWED' | 'DENIED', reason: string | null) =>
    db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'AGENCY_COLLECTION_GUEST_FILE_READ',
        actorAccountId: scope.accountId,
        actorRole: 'org:collection_response',
        action: 'DOWNLOAD_ORIGINAL',
        method: 'API',
        result,
        resourceType: 'agency_collection_guest_submission',
        resourceId: submission.id,
        reason,
        metadata: { organizationId: scope.organizationId, requestId: submission.requestId },
      });
    });
  if (!line || !intactSubmission(submission, lines)) {
    await audit('DENIED', line ? 'submission_changed' : 'not_in_submission');
    return err(missing());
  }
  if (!StepUpProof.covers(input.stepUp, guestFileStepUp({ ...scope, fileId: input.fileId }))) {
    await audit('DENIED', 'step_up_required');
    return err(
      keyedError('step_up_required', 'evidence_submissions.confirm_it_is_you_to_download'),
    );
  }
  const file = first(
    await db
      .select()
      .from(schema.agencyCollectionGuestFiles)
      .where(
        and(
          eq(schema.agencyCollectionGuestFiles.id, input.fileId),
          eq(schema.agencyCollectionGuestFiles.organizationId, scope.organizationId),
          eq(schema.agencyCollectionGuestFiles.requestId, submission.requestId),
          eq(schema.agencyCollectionGuestFiles.recipientKey, submission.recipientKey),
          eq(schema.agencyCollectionGuestFiles.safetyStatus, 'CLEAN'),
        ),
      )
      .limit(1),
  );
  const stored = file ? await storage.getObject(file.objectKey) : undefined;
  const hash = stored ? createHash('sha256').update(stored.bytes).digest('hex') : null;
  if (!file || !stored || hash !== line.fileSha256 || hash !== file.sha256) {
    await audit('DENIED', 'bytes_unavailable');
    return err(keyedError('forbidden', 'umpe_guest_agency.this_file_is_not_available'));
  }
  await audit('ALLOWED', null);
  return ok({
    bytes: stored.bytes,
    contentType: file.contentType,
    filename: line.title ?? file.originalName,
  });
}

// --- Legal holds on a request's guest files ---------------------------------------------------

export interface GuestHoldView {
  readonly reason: string;
  readonly placedAt: Date;
}

async function requestOfAgency(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  lock = false,
): Promise<{ id: string } | undefined> {
  if (!isUuid(requestId)) return undefined;
  const query = db
    .select({ id: schema.agencyCollectionRequests.id })
    .from(schema.agencyCollectionRequests)
    .where(
      and(
        eq(schema.agencyCollectionRequests.id, requestId),
        eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
      ),
    )
    .limit(1);
  return first(lock ? await query.for('update') : await query);
}

/** The active legal hold on this request's guest files, or null. */
export async function readGuestHold(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
): Promise<GuestHoldView | null> {
  if (agencyCollectionScopeProblem(scope)) return null;
  if (!isUuid(requestId) || !(await guestUploadsPresent(db))) return null;
  const hold = first(
    await db
      .select({
        reason: schema.agencyCollectionGuestHolds.reason,
        placedAt: schema.agencyCollectionGuestHolds.placedAt,
      })
      .from(schema.agencyCollectionGuestHolds)
      .where(
        and(
          eq(schema.agencyCollectionGuestHolds.requestId, requestId),
          eq(schema.agencyCollectionGuestHolds.organizationId, scope.organizationId),
          isNull(schema.agencyCollectionGuestHolds.releasedAt),
        ),
      )
      .orderBy(desc(schema.agencyCollectionGuestHolds.placedAt))
      .limit(1),
  );
  return hold ?? null;
}

/**
 * Place a legal hold on the guest files of this request: while it is active, they are kept past
 * the period the guest chose. A reason is required. One active hold at a time.
 */
export async function placeGuestHold(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  reason: unknown,
  now: Date = new Date(),
): Promise<Result<GuestHoldView, ServiceError>> {
  const problem = agencyCollectionScopeProblem(scope);
  if (problem) return err(problem);
  if (!(await guestUploadsPresent(db))) return err(missing());
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 1 || text.length > 500) {
    return err(keyedError('invalid', 'umpe_guest_agency.give_the_reason_for_the_hold'));
  }
  return db.transaction(async (tx) => {
    // The request row lock orders a hold against the purge, which takes the same lock.
    if (!(await requestOfAgency(tx, scope, requestId, true))) return err(missing());
    const active = await readGuestHold(tx, scope, requestId);
    if (active) return ok(active);
    await tx.insert(schema.agencyCollectionGuestHolds).values({
      organizationId: scope.organizationId,
      requestId,
      reason: text,
      placedByAccountId: scope.accountId,
      placedAt: now,
    });
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_GUEST_HOLD_PLACED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'agency_collection_request',
      resourceId: requestId,
      metadata: { organizationId: scope.organizationId },
    });
    return ok({ reason: text, placedAt: now });
  });
}

/** Release the active hold: the guest's chosen period applies again from the next purge. */
export async function releaseGuestHold(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  now: Date = new Date(),
): Promise<Result<{ readonly released: number }, ServiceError>> {
  const problem = agencyCollectionScopeProblem(scope);
  if (problem) return err(problem);
  if (!(await guestUploadsPresent(db))) return err(missing());
  return db.transaction(async (tx) => {
    if (!(await requestOfAgency(tx, scope, requestId, true))) return err(missing());
    const released = await tx
      .update(schema.agencyCollectionGuestHolds)
      .set({ releasedAt: now, releasedByAccountId: scope.accountId })
      .where(
        and(
          eq(schema.agencyCollectionGuestHolds.requestId, requestId),
          eq(schema.agencyCollectionGuestHolds.organizationId, scope.organizationId),
          isNull(schema.agencyCollectionGuestHolds.releasedAt),
        ),
      )
      .returning({ id: schema.agencyCollectionGuestHolds.id });
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_GUEST_HOLD_RELEASED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'agency_collection_request',
      resourceId: requestId,
      metadata: { organizationId: scope.organizationId, released: released.length },
    });
    return ok({ released: released.length });
  });
}
