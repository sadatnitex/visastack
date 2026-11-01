import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type CappedRows, getMissionForOwner } from './missions';
import {
  type Page,
  type PageRequest,
  clampLimit,
  cursorOrder,
  cursorTime,
  decodeTimeCursor,
  encodeTimeCursor,
  olderThan,
  toPage,
} from './paging';
import { type PlatformAuthInput, canPerformPlatformAction } from './platform-roles';

/**
 * TRU-04 (master directive Part 7 §9): private post-case feedback.
 *
 * "Restricted authorized quality users" means exactly that: no
 * organization-facing read path exists anywhere in this file or its schema
 * -- an agency being reviewed can never see feedback about its own service,
 * only QUALITY_ADMIN platform staff (`listFeedbackForQualityReview`) or the
 * traveller who submitted it (`listFeedbackForMission`). "No public
 * review/ranking in V1" and "do not expose sensitive refusal/medical
 * narrative in analytics" both need no defensive code here: nothing in this
 * file aggregates, scores, or publishes anything -- it is plain
 * submit/list, and any future analytics feature built on top of this data
 * is where those two directive lines would actually need enforcing.
 */

export type CaseFeedback = typeof schema.caseFeedback.$inferSelect;

export async function submitFeedback(
  db: Db,
  input: { readonly actorAccountId: string; readonly missionId: string; readonly comments: string },
): Promise<Result<CaseFeedback, ServiceError>> {
  const owned = await getMissionForOwner(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;

  const comments = input.comments.trim();
  if (comments.length === 0) return err(serviceError('invalid', 'feedback comments are required'));

  return db.transaction(async (tx) => {
    const feedback = required(
      first(
        await tx
          .insert(schema.caseFeedback)
          .values({
            missionId: input.missionId,
            submittedByAccountId: input.actorAccountId,
            comments,
          })
          .returning(),
      ),
      'feedback',
    );
    await appendAuditEvent(tx, {
      eventType: 'CASE_FEEDBACK_SUBMITTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'case_feedback',
      resourceId: feedback.id,
    });
    return ok(feedback);
  });
}

/**
 * Feedback submitted on a mission, newest first (owner-scoped to the case). With `options.limit` (WP-SB2) only the
 * newest `limit` rows come back (clamped to 1 to 100) with the case's total, behind the same owner
 * check.
 */
export async function listFeedbackForMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<CaseFeedback[], ServiceError>>;
export async function listFeedbackForMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
  options: { readonly limit?: number },
): Promise<Result<CappedRows<CaseFeedback>, ServiceError>>;
export async function listFeedbackForMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
  options?: { readonly limit?: number },
): Promise<Result<CaseFeedback[] | CappedRows<CaseFeedback>, ServiceError>> {
  const owned = await getMissionForOwner(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  if (!options) {
    const rows = await db
      .select()
      .from(schema.caseFeedback)
      .where(eq(schema.caseFeedback.missionId, missionId));
    return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }
  const onCase = eq(schema.caseFeedback.missionId, missionId);
  const [items, counts] = await Promise.all([
    db
      .select()
      .from(schema.caseFeedback)
      .where(onCase)
      .orderBy(desc(schema.caseFeedback.createdAt), desc(schema.caseFeedback.id))
      .limit(clampLimit(options.limit)),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.caseFeedback).where(onCase),
  ]);
  return ok({ items, total: Number(counts[0]?.total ?? 0) });
}

/** QUALITY_ADMIN-only: every submitted feedback record platform-wide, newest first. */
export async function listFeedbackForQualityReview(
  db: Db,
  actor: PlatformAuthInput,
): Promise<Result<CaseFeedback[], ServiceError>>;
/**
 * WP-SB6: one page of the same list, newest first, with the number of records in all. `before`
 * is the previous page's `nextCursor`, bound to this list; anything else gives the first page.
 * The role check is the same as above.
 */
export async function listFeedbackForQualityReview(
  db: Db,
  actor: PlatformAuthInput,
  options: PageRequest,
): Promise<Result<Page<CaseFeedback> & { readonly total: number }, ServiceError>>;
export async function listFeedbackForQualityReview(
  db: Db,
  actor: PlatformAuthInput,
  options?: PageRequest,
): Promise<Result<CaseFeedback[] | (Page<CaseFeedback> & { readonly total: number }), ServiceError>> {
  if (!(await canPerformPlatformAction(db, actor, 'FEEDBACK_VIEW'))) {
    return err(serviceError('forbidden', 'quality-admin permission is required'));
  }
  if (!options) {
    const rows = await db.select().from(schema.caseFeedback);
    return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }
  const f = schema.caseFeedback;
  const scope = 'platform:feedback';
  const limit = clampLimit(options.limit);
  const before = decodeTimeCursor(options.before, scope);
  const [rows, counted] = await Promise.all([
    db
      .select({ feedback: f, cursorAt: cursorTime(f.createdAt) })
      .from(f)
      .where(before ? olderThan(f.createdAt, f.id, before) : undefined)
      .orderBy(...cursorOrder(f.createdAt, f.id))
      .limit(limit + 1),
    db.select({ total: sql<number>`count(*)::int` }).from(f),
  ]);
  const page = toPage(rows, limit, (last) =>
    encodeTimeCursor({ at: last.cursorAt, id: last.feedback.id }, scope),
  );
  return ok({
    items: page.items.map((row) => row.feedback),
    nextCursor: page.nextCursor,
    total: Number(counted[0]?.total ?? 0),
  });
}
