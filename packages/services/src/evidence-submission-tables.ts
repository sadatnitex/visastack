/**
 * Lane D: whether the exact-copy tables for evidence requests exist yet (migration 0132). The code
 * ships before the migration runs in production, so until then every reader says "not available"
 * and the older flow keeps working, plainly marked as not keeping an exact copy. `to_regclass`
 * never raises, so a surrounding transaction is never aborted. Only "present" is remembered per
 * database handle (a table is never dropped); "missing" is asked again next time, so the first
 * request after the migration already sees it.
 *
 * Kept in its own file with no service imports so any module can ask without a circular import.
 */
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { type Db, schema } from './db';

/** The exact-copy tables of migration 0132. */
export const SUBMISSION_TABLES = [
  'evidence_request_submissions',
  'evidence_request_decision_submissions',
] as const;

const present = new WeakSet<object>();

/** Both exact-copy tables (migration 0132) exist on this database. */
export async function evidenceSubmissionsPresent(db: Db): Promise<boolean> {
  if (present.has(db)) return true;
  const checks = SUBMISSION_TABLES.map((t) => sql`to_regclass(${t}::text) is not null`);
  const rows = await db
    .select({ present: sql<boolean>`(${sql.join(checks, sql` and `)})` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.present === true;
  if (found) present.add(db);
  return found;
}

/**
 * Whether the version row still is, as far as the record knows, what was sent: the same document,
 * the same stored object and the same checksum (both unknown counts as the same).
 */
export function pinnedVersionIntact(
  submission: { documentId: string; storageObjectId: string; contentSha256: string | null },
  version: { documentId: string; storageObjectId: string; sha256: string | null },
): boolean {
  return (
    version.documentId === submission.documentId &&
    version.storageObjectId === submission.storageObjectId &&
    (version.sha256 ?? null) === (submission.contentSha256 ?? null)
  );
}

/**
 * A decision on this request, made after the send was recorded, that is not linked to any send. It
 * means an older deployment (running beside the new one) decided the request without knowing about
 * exact copies, so the send was in fact already decided and must not serve bytes or be decided
 * again. Returns the earliest such decision, or undefined.
 */
export async function newerUnlinkedDecision(
  db: Db,
  requestId: string,
  sentAt: Date,
): Promise<{ id: string; outcome: string; decidedAt: Date } | undefined> {
  const rows = await db
    .select({
      id: schema.evidenceRequestDecisions.id,
      outcome: schema.evidenceRequestDecisions.outcome,
      decidedAt: schema.evidenceRequestDecisions.createdAt,
    })
    .from(schema.evidenceRequestDecisions)
    .leftJoin(
      schema.evidenceRequestDecisionSubmissions,
      eq(schema.evidenceRequestDecisionSubmissions.decisionId, schema.evidenceRequestDecisions.id),
    )
    .where(
      and(
        eq(schema.evidenceRequestDecisions.evidenceRequestId, requestId),
        gt(schema.evidenceRequestDecisions.createdAt, sentAt),
        isNull(schema.evidenceRequestDecisionSubmissions.decisionId),
      ),
    )
    .orderBy(asc(schema.evidenceRequestDecisions.createdAt))
    .limit(1);
  return rows[0];
}
