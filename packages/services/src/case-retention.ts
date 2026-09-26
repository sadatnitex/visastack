import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { type Db, first, schema } from './db';
import { enqueueNotificationBothChannels } from './notifications';

/**
 * Closed-case retention notice (PRV-02, master directive Part 7 §11):
 * "closed case: initial proposed 12m with 30d notice." The directive's own
 * retention table calls every one of its numbers "PRD proposed defaults --
 * not immutable legal facts," so the notice threshold is env-overridable,
 * matching every other numeric retention/quota default in this codebase
 * (e.g. `QUOTA_MAX_PDF_PAGES`).
 *
 * "Closed" here means either terminal case state -- CLOSED or CANCELLED --
 * treated identically: both mean "this case will never be worked again"
 * (`missions.ts`'s own `TRANSITIONS` map gives both an empty legal-move
 * list), and the directive names only "closed case" without splitting the
 * two. `missions.closedAt` is set once, by `transitionMission`, the moment
 * either is first reached.
 *
 * This sweep is the NOTICE half only -- it sends a real, informational
 * notification through the existing outbox and records when it did.
 * Neither CLOSED nor CANCELLED has any reopen path today, so there is no
 * in-app action that stops the clock: the notice exists to give the case
 * owner a chance to export anything they still need, not to collect a
 * response. The corresponding PURGE sweep (30 days after this notice) is
 * deliberately separate: it deletes real data across several tables and
 * needs its own careful per-table scoping, tracked as the next PRV-02 chunk.
 */
const DEFAULT_CASE_RETENTION_NOTICE_MONTHS = 12;
const DEFAULT_CASE_RETENTION_NOTICE_SWEEP_LIMIT = 200;

function envInt(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): number | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function caseRetentionNoticeMonths(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return envInt(env, 'CASE_RETENTION_NOTICE_MONTHS') ?? DEFAULT_CASE_RETENTION_NOTICE_MONTHS;
}

export interface CaseRetentionNoticeSweepResult {
  readonly checked: number;
  readonly notified: number;
}

export async function sweepCaseRetentionNotices(
  db: Db,
  limit = DEFAULT_CASE_RETENTION_NOTICE_SWEEP_LIMIT,
): Promise<CaseRetentionNoticeSweepResult> {
  const months = caseRetentionNoticeMonths();
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

  const due = await db
    .select({
      missionId: schema.missions.id,
      applicantId: schema.missions.applicantId,
      ownerAccountId: schema.applicants.ownerAccountId,
    })
    .from(schema.missions)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
    .where(
      and(
        isNotNull(schema.missions.closedAt),
        lte(schema.missions.closedAt, cutoff),
        isNull(schema.missions.retentionNoticeSentAt),
      ),
    )
    .limit(limit);

  let notified = 0;
  for (const row of due) {
    const sent = await db.transaction(async (tx) => {
      // Compare-and-set on `retentionNoticeSentAt` still being null: makes
      // this idempotent against a concurrent or re-run sweep, the same
      // discipline `sweepAbandonedUploads` uses for its own status flip.
      const updated = first(
        await tx
          .update(schema.missions)
          .set({ retentionNoticeSentAt: new Date() })
          .where(
            and(
              eq(schema.missions.id, row.missionId),
              isNull(schema.missions.retentionNoticeSentAt),
            ),
          )
          .returning({ id: schema.missions.id }),
      );
      if (!updated) return false;
      await enqueueNotificationBothChannels(tx, {
        eventType: 'CASE_RETENTION_NOTICE',
        resourceId: row.missionId,
        recipientAccountId: row.ownerAccountId,
        applicantId: row.applicantId,
        missionId: row.missionId,
        payload: {
          subject: 'Case data scheduled for deletion in 30 days',
          summary: `This case has been closed for ${months} months. Its case records will be permanently deleted in 30 days. Export anything you still need before then.`,
          deepLinkPath: `/app/mission/${row.missionId}`,
        },
      });
      return true;
    });
    if (sent) notified++;
  }
  return { checked: due.length, notified };
}
