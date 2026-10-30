import { and, eq, inArray, isNotNull, isNull, lte, notInArray } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { missionBlockedByLegalHold } from './legal-hold';
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

/**
 * Closed-case retention PURGE (PRV-02, master directive Part 7 §11), the
 * second half deliberately deferred when the notice sweep above shipped:
 * the notice text itself already promises "permanently deleted in 30 days,"
 * so this sweep's grace period is not an independent choice -- it must
 * match that promise exactly.
 *
 * Deletes this mission's own WORKFLOW content -- every case-scoped table
 * whose `mission_id` FK is declared `onDelete: 'cascade'` in the schema
 * (mission_snapshots, acknowledgements, assignments, mission_notes,
 * evidence_requests (+ evidence_request_decisions), contributor_requests,
 * selected_evidence, mission_decisions, mission_tasks, mission_appointments,
 * generated_outputs, and any mission-scoped grant or notification) -- via
 * explicit per-table deletes, then REDACTS (never deletes) the mission row
 * itself: its free-text and scheduling fields are overwritten with a fixed
 * placeholder/null, `purgedAt` is set, and the row otherwise survives.
 *
 * Deliberately NOT deleted, by explicit design rather than oversight:
 * mission_outcomes, mission_submissions, case_complaints (+ its own
 * case_complaint_events), and case_feedback. Each is a historical fact --
 * a decision outcome, an external submission report, a filed complaint, a
 * private post-case quality review -- with its own accountability/oversight
 * value that does not expire just because the traveller-facing case
 * workspace is no longer useful to the traveller, and each of these four
 * tables' `mission_id` is NOT NULL (unlike every cascading table above), so
 * they cannot survive a genuinely deleted mission row without their own
 * schema change loosening that constraint -- not a call this sweep makes
 * silently by convenience of the schema's cascade wiring. This is exactly
 * why the mission row is redacted in place rather than deleted outright:
 * these four tables need a still-valid `mission_id` to keep pointing at.
 *
 * `audit_events.mission_id` is deliberately a plain uuid, not an FK (see
 * its own schema comment) -- untouched either way. The audit event appended
 * before redaction, capturing the mission's pre-redaction identifying
 * fields in `metadata`, is the durable record of exactly what this sweep
 * removed.
 *
 * Purging real, irreversible case data is a materially different risk than
 * sending a notice, so this sweep is OFF by default: `enabled` is only ever
 * true when `CASE_RETENTION_PURGE_ENABLED` is literally the string
 * "true" -- every other value, including unset, is a safe no-op.
 *
 * A mission is skipped (never purged, this run) if either:
 * - its applicant has an active legal hold (Part 7 §13: a hold blocks
 *   erasure; case data is exactly the kind of record a hold exists to
 *   preserve, the same reasoning `requestAccountDeletion`'s own pre-check
 *   already applies to whole-account deletion); or
 * - it has an unresolved complaint (OPEN or IN_PROGRESS) -- purging the
 *   workflow content the very case a dispute is about, while that dispute
 *   is still open, would destroy context the complaint needs.
 * Neither is a permanent exemption: both are rechecked on every sweep run,
 * so a mission purges automatically once its hold is released or its
 * complaint is resolved/closed, without any further action.
 */
const DEFAULT_CASE_RETENTION_PURGE_GRACE_DAYS = 30;
const DEFAULT_CASE_RETENTION_PURGE_SWEEP_LIMIT = 200;
const UNRESOLVED_COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS'] as const;
const PURGED_TITLE_PLACEHOLDER = '[case data purged]';

function envRaw(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return env[name];
}

function caseRetentionPurgeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return envRaw(env, 'CASE_RETENTION_PURGE_ENABLED') === 'true';
}

function caseRetentionPurgeGraceDays(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return envInt(env, 'CASE_RETENTION_PURGE_GRACE_DAYS') ?? DEFAULT_CASE_RETENTION_PURGE_GRACE_DAYS;
}

export interface CaseRetentionPurgeSweepResult {
  readonly enabled: boolean;
  readonly checked: number;
  readonly purged: number;
  readonly skippedForHold: number;
  readonly skippedForComplaint: number;
}

async function hasUnresolvedComplaint(db: Db, missionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.caseComplaints.id })
    .from(schema.caseComplaints)
    .where(
      and(
        eq(schema.caseComplaints.missionId, missionId),
        inArray(schema.caseComplaints.status, UNRESOLVED_COMPLAINT_STATUSES),
      ),
    )
    .limit(1);
  return first(rows) !== undefined;
}

export interface MissionForPurge {
  readonly missionId: string;
  readonly applicantId: string;
  readonly title: string;
  readonly state: string;
  readonly closedAt: Date | null;
  readonly retentionNoticeSentAt: Date | null;
}

/**
 * The unconditional purge mechanism itself -- audits, then deletes this
 * mission's workflow content and redacts the row, exactly as this module's
 * own doc comment describes. Deliberately takes the mission's pre-purge
 * field values as input rather than re-reading them, and performs NO
 * eligibility checks (grace days, legal hold, unresolved complaint) of its
 * own -- those are the caller's responsibility.
 *
 * Two callers: `sweepCaseRetentionPurge` below, which gates this behind its
 * own lock-and-recheck eligibility gauntlet; and backup-resurrection
 * reconciliation (`backup-reconciliation.ts`), which forces the exact same
 * end state a `MISSION_RETENTION_PURGED` event on the pre-incident branch
 * already proves was correctly decided there -- re-checking eligibility
 * against the restored branch's own (possibly stale or divergent) hold/
 * complaint state would be exactly the wrong precondition to apply during
 * reconciliation. Never call this without ensuring eligibility was already
 * established by one of those two paths.
 */
export async function purgeMissionUnconditionally(
  db: Db,
  mission: MissionForPurge,
  reason: string,
): Promise<void> {
  await appendAuditEvent(db, {
    eventType: 'MISSION_RETENTION_PURGED',
    action: 'MANAGE',
    method: 'SYSTEM',
    result: 'ALLOWED',
    applicantId: mission.applicantId,
    missionId: mission.missionId,
    resourceType: 'mission',
    resourceId: mission.missionId,
    reason,
    metadata: {
      title: mission.title,
      state: mission.state,
      closedAt: mission.closedAt?.toISOString() ?? null,
      retentionNoticeSentAt: mission.retentionNoticeSentAt?.toISOString() ?? null,
    },
  });

  // Workflow content only -- see this module's own doc comment for exactly
  // which tables are (and are deliberately not) included here. A snapshot
  // still referenced by a preserved mission_submissions row must survive
  // too: that FK is NOT NULL + onDelete:'restrict' (a submission's own
  // snapshotId is "the exact thing that was actually submitted," not an
  // incidental link), so deleting it here would either violate the
  // constraint or, worse, silently orphan the historical submission record
  // this purge exists to protect.
  const referencedSnapshotRows = await db
    .select({ id: schema.missionSubmissions.snapshotId })
    .from(schema.missionSubmissions)
    .where(eq(schema.missionSubmissions.missionId, mission.missionId));
  const referencedSnapshotIds = referencedSnapshotRows.map((r) => r.id);
  await db
    .delete(schema.missionSnapshots)
    .where(
      referencedSnapshotIds.length > 0
        ? and(
            eq(schema.missionSnapshots.missionId, mission.missionId),
            notInArray(schema.missionSnapshots.id, referencedSnapshotIds),
          )
        : eq(schema.missionSnapshots.missionId, mission.missionId),
    );
  await db
    .delete(schema.acknowledgements)
    .where(eq(schema.acknowledgements.missionId, mission.missionId));
  await db.delete(schema.assignments).where(eq(schema.assignments.missionId, mission.missionId));
  await db.delete(schema.missionNotes).where(eq(schema.missionNotes.missionId, mission.missionId));
  await db
    .delete(schema.evidenceRequests)
    .where(eq(schema.evidenceRequests.missionId, mission.missionId));
  await db
    .delete(schema.contributorRequests)
    .where(eq(schema.contributorRequests.missionId, mission.missionId));
  await db
    .delete(schema.selectedEvidence)
    .where(eq(schema.selectedEvidence.missionId, mission.missionId));
  await db
    .delete(schema.missionDecisions)
    .where(eq(schema.missionDecisions.missionId, mission.missionId));
  await db.delete(schema.missionTasks).where(eq(schema.missionTasks.missionId, mission.missionId));
  await db
    .delete(schema.missionAppointments)
    .where(eq(schema.missionAppointments.missionId, mission.missionId));
  await db
    .delete(schema.generatedOutputs)
    .where(eq(schema.generatedOutputs.missionId, mission.missionId));
  await db.delete(schema.grants).where(eq(schema.grants.missionId, mission.missionId));
  await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.missionId, mission.missionId));

  await db
    .update(schema.missions)
    .set({
      title: PURGED_TITLE_PLACEHOLDER,
      destination: null,
      purpose: null,
      itineraryRef: null,
      jurisdiction: null,
      serviceCategory: null,
      travelStartDate: null,
      travelEndDate: null,
      targetDeadline: null,
      purgedAt: new Date(),
    })
    .where(eq(schema.missions.id, mission.missionId));
}

export async function sweepCaseRetentionPurge(
  db: Db,
  limit = DEFAULT_CASE_RETENTION_PURGE_SWEEP_LIMIT,
): Promise<CaseRetentionPurgeSweepResult> {
  if (!caseRetentionPurgeEnabled()) {
    return { enabled: false, checked: 0, purged: 0, skippedForHold: 0, skippedForComplaint: 0 };
  }
  const graceDays = caseRetentionPurgeGraceDays();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - graceDays);

  const dueWhere = and(
    isNotNull(schema.missions.retentionNoticeSentAt),
    lte(schema.missions.retentionNoticeSentAt, cutoff),
    isNull(schema.missions.purgedAt),
  );

  const due = await db
    .select({
      missionId: schema.missions.id,
      applicantId: schema.missions.applicantId,
      title: schema.missions.title,
      state: schema.missions.state,
      closedAt: schema.missions.closedAt,
      retentionNoticeSentAt: schema.missions.retentionNoticeSentAt,
    })
    .from(schema.missions)
    .where(dueWhere)
    .limit(limit);

  let purged = 0;
  let skippedForHold = 0;
  let skippedForComplaint = 0;

  for (const row of due) {
    if (
      await missionBlockedByLegalHold(db, {
        applicantId: row.applicantId,
        missionId: row.missionId,
      })
    ) {
      skippedForHold++;
      continue;
    }
    if (await hasUnresolvedComplaint(db, row.missionId)) {
      skippedForComplaint++;
      continue;
    }

    const didPurge = await db.transaction(async (tx) => {
      // Lock and re-verify eligibility before acting -- the same
      // "lock, recheck, then act" discipline `executeAccountDeletion` and
      // `placeLegalHold` already use, so a hold or complaint that lands in
      // the gap between the checks above and this transaction, or a
      // concurrent sweep run, can never be raced past.
      const locked = first(
        await tx
          .select({ id: schema.missions.id })
          .from(schema.missions)
          .where(and(eq(schema.missions.id, row.missionId), dueWhere))
          .for('update')
          .limit(1),
      );
      if (!locked) return false;
      if (
        await missionBlockedByLegalHold(tx, {
          applicantId: row.applicantId,
          missionId: row.missionId,
        })
      )
        return false;
      if (await hasUnresolvedComplaint(tx, row.missionId)) return false;

      await purgeMissionUnconditionally(tx, row, 'closed-case retention period elapsed');
      return true;
    });
    if (didPurge) purged++;
  }

  return { enabled: true, checked: due.length, purged, skippedForHold, skippedForComplaint };
}
