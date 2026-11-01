import { type Result, err, ok } from '@visastack/core';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from '../../access/principal';
import { type Db, schema } from '../../db';
import type { ServiceError } from '../../errors';
// The read-path guard recognises the condition by its foundation path (read-paths.test-support.ts).
import { presentDocumentCondition } from '../../lifecycle/foundation/conditions';
import { lifecycleTablesPresent } from '../foundation/presence';
import { workingDaysBetween } from '../removal-requests/working-days';

/**
 * The resource lifecycle measures (PROGRAMME section 9), for the admin Product Scorecard. Counts
 * only: no name, title, id or fingerprint leaves this function. Starting targets, to confirm
 * after 30 days of pilot data, are carried beside each figure so the screen can say whether it
 * is within target.
 */
export interface LifecycleMeasures {
  /** False while migration 0113 has not run: the figures that read lifecycle tables are null. */
  readonly tablesPresent: boolean;
  /** Expiry reminders (first one per document, 14 to 90 days ago) followed by a replacement within 14 days. Target: at least 40%. */
  readonly reminderToReplacement: {
    readonly reminded: number;
    readonly replacedWithin14Days: number;
    readonly percent: number | null;
    readonly target: 40;
  };
  /** Exact duplicates still kept, per 100 present documents (latest file of each). Target: under 3. */
  readonly duplicatesKept: {
    readonly documents: number;
    readonly duplicates: number;
    readonly per100: number | null;
    readonly target: 3;
  };
  /** Restores (from Archived and from Recently Deleted) per 100 deletions and archives, last 30 days. Target: under 10. */
  readonly restores: {
    readonly deletionsAndArchives: number;
    readonly restores: number;
    readonly per100: number | null;
    readonly target: 10;
  };
  /** Removal requests: median working days to a decision, and how many took or have waited over 30 days. Target: median 3 or less, none over 30. */
  readonly removalDecisions: {
    readonly decided: number;
    readonly medianWorkingDays: number | null;
    readonly overThirtyDays: number;
    readonly targetMedian: 3;
    readonly targetMaxDays: 30;
  } | null;
}

const DAY = 24 * 60 * 60 * 1000;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return Math.round(value * 10) / 10;
}

const rate = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

const RESTORE_EVENTS = ['DOCUMENT_RESTORED', 'DOCUMENT_DELETE_UNDONE'] as const;
const REMOVE_EVENTS = [
  'DOCUMENT_ARCHIVED',
  'DOCUMENT_DELETED',
  'DUPLICATE_REMOVED_AT_UPLOAD',
] as const;

/**
 * Read the lifecycle measures. Staff only, with the compliance directory view (the same authority
 * that reads Removal Records), because the figures are counted over people's records.
 */
export async function getLifecycleMeasures(
  db: Db,
  staff: StaffScope<'APPLICANT_DIRECTORY_VIEW'>,
  options: { readonly now?: Date } = {},
): Promise<Result<LifecycleMeasures, ServiceError>> {
  const problem = staffScopeProblem(staff, 'APPLICANT_DIRECTORY_VIEW');
  if (problem) return err(problem);
  const now = options.now ?? new Date();
  const tablesPresent = await lifecycleTablesPresent(db);

  // 1. Expiry reminder to replacement within 14 days.
  const firstReminders = await db
    .select({
      documentId: schema.notifications.resourceId,
      firstAt: sql<Date>`min(${schema.notifications.createdAt})`.mapWith(
        (value: string | Date) => new Date(value),
      ),
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.eventType, 'DOCUMENT_EXPIRY'))
    .groupBy(schema.notifications.resourceId);
  const settled = firstReminders.filter(
    (r): r is { documentId: string; firstAt: Date } =>
      r.documentId !== null &&
      r.firstAt.getTime() <= now.getTime() - 14 * DAY &&
      r.firstAt.getTime() >= now.getTime() - 90 * DAY,
  );
  const replacements =
    settled.length === 0
      ? []
      : await db
          .select({
            documentId: schema.auditEvents.resourceId,
            at: schema.auditEvents.occurredAt,
          })
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.eventType, 'DOCUMENT_SUPERSEDED'),
              inArray(
                schema.auditEvents.resourceId,
                settled.map((r) => r.documentId),
              ),
            ),
          );
  const replacedWithin14Days = settled.filter((reminder) =>
    replacements.some(
      (r) =>
        r.documentId === reminder.documentId &&
        r.at.getTime() >= reminder.firstAt.getTime() &&
        r.at.getTime() <= reminder.firstAt.getTime() + 14 * DAY,
    ),
  ).length;

  // 2. Exact duplicates kept: the latest file of each present document, grouped by person and
  // fingerprint. Only counts leave the database.
  const latest = db
    .select({
      applicantId: schema.documents.applicantId,
      sha256: schema.documentVersions.sha256,
      rank: sql<number>`row_number() over (partition by ${schema.documentVersions.documentId} order by ${schema.documentVersions.versionNumber} desc)`.as(
        'rank',
      ),
    })
    .from(schema.documents)
    .innerJoin(schema.documentVersions, eq(schema.documentVersions.documentId, schema.documents.id))
    .where(tablesPresent ? presentDocumentCondition() : undefined)
    .as('latest');
  const groups = db
    .select({ copies: sql<number>`count(*)`.as('copies') })
    .from(latest)
    .where(eq(latest.rank, 1))
    .groupBy(latest.applicantId, latest.sha256)
    .as('groups');
  const [duplicateRow] = await db
    .select({
      documents: sql<string>`coalesce(sum(${groups.copies}), 0)`,
      duplicates: sql<string>`coalesce(sum(${groups.copies} - 1), 0)`,
    })
    .from(groups);
  const documents = Number(duplicateRow?.documents ?? 0);
  const duplicates = Number(duplicateRow?.duplicates ?? 0);

  // 3. Restores per 100 deletions and archives, last 30 days.
  const since = new Date(now.getTime() - 30 * DAY);
  const eventRows = await db
    .select({ eventType: schema.productEvents.eventType, count: sql<string>`count(*)` })
    .from(schema.productEvents)
    .where(
      and(
        inArray(schema.productEvents.eventType, [...RESTORE_EVENTS, ...REMOVE_EVENTS]),
        gte(schema.productEvents.occurredAt, since),
        lt(schema.productEvents.occurredAt, now),
      ),
    )
    .groupBy(schema.productEvents.eventType);
  const countOf = (types: readonly string[]) =>
    eventRows
      .filter((row) => types.includes(row.eventType))
      .reduce((sum, row) => sum + Number(row.count), 0);
  const restores = countOf(RESTORE_EVENTS);
  const deletionsAndArchives = countOf(REMOVE_EVENTS);

  // 4. Removal requests decided (PRV-03): median working days, and any over 30 days.
  let removalDecisions: LifecycleMeasures['removalDecisions'] = null;
  if (tablesPresent) {
    const requests = await db
      .select({
        requestedAt: schema.documentRemovalRequests.requestedAt,
        decidedAt: schema.documentRemovalRequests.decidedAt,
        status: schema.documentRemovalRequests.status,
      })
      .from(schema.documentRemovalRequests);
    const decided = requests.filter((r) => r.decidedAt !== null);
    const overThirtyDays = requests.filter((r) => {
      if (r.status === 'CANCELLED') return false;
      const end = r.decidedAt ?? (r.status === 'PENDING' ? now : null);
      return end !== null && end.getTime() - r.requestedAt.getTime() > 30 * DAY;
    }).length;
    removalDecisions = {
      decided: decided.length,
      medianWorkingDays: median(
        decided.map((r) => workingDaysBetween(r.requestedAt, r.decidedAt ?? now)),
      ),
      overThirtyDays,
      targetMedian: 3,
      targetMaxDays: 30,
    };
  }

  return ok({
    tablesPresent,
    reminderToReplacement: {
      reminded: settled.length,
      replacedWithin14Days,
      percent: rate(replacedWithin14Days, settled.length),
      target: 40,
    },
    duplicatesKept: { documents, duplicates, per100: rate(duplicates, documents), target: 3 },
    restores: {
      deletionsAndArchives,
      restores,
      per100: rate(restores, deletionsAndArchives),
      target: 10,
    },
    removalDecisions,
  });
}
