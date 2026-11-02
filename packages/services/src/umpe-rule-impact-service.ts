/**
 * UMPE P11 (S07): what a newly published checklist version means for work already under way.
 *
 * When a pack version is published, every ACTIVE case pinned to an older version of the same pack
 * gets one impact record with one precise item (the most important difference: an item added,
 * then changed, then removed) and one note to the case owner. Nothing is rewritten:
 *
 * - The case keeps its pinned version until its owner chooses otherwise. Its trip package shows
 *   the change through P4's own "something changed" item (recorded when the case is opened or
 *   swept), so this module never writes P4's rows; it only sends the person there.
 * - Closed, cancelled, submitted and purged cases are never flagged. Handoff snapshots, mission
 *   snapshots and issued agency revisions are never read for writing, let alone changed.
 * - A newer publication closes the older open impact of the same case as superseded and cancels
 *   its waiting note, so a person meets one current item, not a pile.
 *
 * Three steps, each with its own gate:
 * 1. `queueRuleImpact`, the publish hook (packs.ts): records that the version needs assessing, in
 *    the publish transaction. It reads and writes no person data.
 * 2. `assessRuleImpact` (pack management staff, right after publishing) and `sweepRuleImpacts`
 *    (the scheduled sweep, a safety net): find the affected cases, record the impacts and queue
 *    the notes, a bounded number per call.
 * 3. The notification worker checks each note again just before sending (notifications.ts).
 *
 * Agency requests are judged through the agency's own scope on the request page
 * (`collectionRuleImpact`): issued revisions stay as they are and reissuing is the agency's choice.
 */
import { type Result, err, ok } from '@visastack/core';
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { StaffScope, SystemScope } from './access';
import {
  type AgencyCollectionScope,
  agencyCollectionScopeProblem,
} from './access/collection-scope';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isUuid } from './lifecycle/foundation/ids';
import { RULE_CHANGED_EVENT, enqueueNotificationBothChannels } from './notifications';
import { type RequirementDiffEntry, diffPackVersions } from './packs';
import { ruleImpactTablesPresent } from './umpe-correction-tables';
import { INACTIVE_CASE_STATES } from './umpe-package-tables';

export type RuleChangeKind = 'ADDED' | 'CHANGED' | 'REMOVED' | 'NONE';

/** The one precise item of a difference between two versions of the same pack. */
export interface RuleChangeItem {
  readonly changeKind: RuleChangeKind;
  readonly itemKind: 'FIELD' | 'DOCUMENT' | null;
  /** The item's rule code (a document type or a profile field key), never a person's value. */
  readonly itemKey: string | null;
  /** How many items differ in all. */
  readonly changedCount: number;
}

const CHANGE_ORDER: readonly RequirementDiffEntry['change'][] = ['added', 'changed', 'removed'];
const ITEM_KEY_MAX = 300;

/** The most important difference (added, then changed, then removed; by key within a kind). */
export function preciseRuleChange(entries: readonly RequirementDiffEntry[]): RuleChangeItem {
  const differing = entries.filter((e) => e.change !== 'unchanged');
  for (const change of CHANGE_ORDER) {
    const entry = differing
      .filter((e) => e.change === change)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))[0];
    if (entry) {
      const code = entry.key.slice(entry.key.indexOf(':') + 1).slice(0, ITEM_KEY_MAX);
      return {
        changeKind: change === 'added' ? 'ADDED' : change === 'changed' ? 'CHANGED' : 'REMOVED',
        itemKind: entry.kind,
        itemKey: code.length > 0 ? code : null,
        changedCount: differing.length,
      };
    }
  }
  return { changeKind: 'NONE', itemKind: null, itemKey: null, changedCount: 0 };
}

/** A rule code in plain words ("bank_statement" reads "Bank Statement"). */
function codeWords(code: string): string {
  return code
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

/** The note's sentence about the change, in plain words. Rule content only, never a person's. */
export function ruleChangeSentence(item: RuleChangeItem): string {
  const others = item.changedCount - 1;
  const more = others > 0 ? ` (and ${others} other ${others === 1 ? 'change' : 'changes'})` : '';
  if (item.changeKind === 'NONE' || !item.itemKey) {
    return 'A newer version of the checklist for one of your trips was published.';
  }
  const name = codeWords(item.itemKey);
  const verb =
    item.changeKind === 'ADDED'
      ? 'was added to'
      : item.changeKind === 'REMOVED'
        ? 'was removed from'
        : 'changed in';
  return `${name} ${verb} the checklist for one of your trips${more}.`;
}

// --- 1. The publish hook lives in umpe-rule-impact-queue.ts (no import cycle with packs.ts) ---

// --- 2. Assessment -----------------------------------------------------------------------------------

export const RULE_IMPACT_NOTE_LIMIT = 200;

export interface RuleImpactProgress {
  /** Runs looked at in this call. */
  readonly runs: number;
  /** Active cases newly flagged in this call. */
  readonly casesFlagged: number;
  /** Notes queued in this call (one per case, in-app and email). */
  readonly notesQueued: number;
  /** Whether notes are still waiting for a later call. */
  readonly more: boolean;
}

const NO_PROGRESS: RuleImpactProgress = { runs: 0, casesFlagged: 0, notesQueued: 0, more: false };

type RunRow = typeof schema.umpeRuleImpactRuns.$inferSelect;

/**
 * Flags the run's affected cases once (locked, so two callers never do it twice): one impact per
 * active case pinned to an older version of the same pack, with that version's precise item.
 * Older open impacts of the same cases are closed as superseded, with their waiting notes.
 */
async function flagCases(db: Db, runId: string, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const run = first(
      await tx
        .select()
        .from(schema.umpeRuleImpactRuns)
        .where(eq(schema.umpeRuleImpactRuns.id, runId))
        .limit(1)
        .for('update'),
    );
    if (!run || run.assessedAt !== null) return 0;
    const version = first(
      await tx
        .select({
          id: schema.packVersions.id,
          packId: schema.packVersions.packId,
          version: schema.packVersions.version,
          status: schema.packVersions.status,
        })
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, run.packVersionId))
        .limit(1),
    );
    let flagged = 0;
    if (version && version.status === 'PUBLISHED') {
      const older = await tx
        .select({ id: schema.packVersions.id })
        .from(schema.packVersions)
        .where(
          and(
            eq(schema.packVersions.packId, version.packId),
            lt(schema.packVersions.version, version.version),
          ),
        );
      for (const previous of older) {
        const diff = await diffPackVersions(tx, previous.id, version.id);
        const item = diff.ok
          ? preciseRuleChange(diff.value.entries)
          : { changeKind: 'NONE' as const, itemKind: null, itemKey: null, changedCount: 0 };
        // One set-based insert per older version: only active, unpurged cases pinned to it.
        const inserted = await tx.execute(sql`
          insert into ${schema.umpeRuleImpacts}
            (run_id, pack_version_id, previous_pack_version_id, subject_kind, mission_id,
             change_kind, item_kind, item_key, changed_count, created_at)
          select ${run.id}, ${version.id}, ${previous.id}, 'CASE', m.id,
                 ${item.changeKind}, ${item.itemKind}, ${item.itemKey}, ${item.changedCount}, ${now}
            from ${schema.missions} m
           where m.pack_version_id = ${previous.id}
             and m.purged_at is null
             and m.state::text not in (${sql.join(
               INACTIVE_CASE_STATES.map((s) => sql`${s}`),
               sql`, `,
             )})
          on conflict do nothing
          returning id`);
        flagged += rowCount(inserted);
      }
      // A newer publication closes the older open impact of the same case.
      const superseded = await tx
        .update(schema.umpeRuleImpacts)
        .set({ resolvedAt: now, resolution: 'SUPERSEDED' })
        .where(
          and(
            isNull(schema.umpeRuleImpacts.resolvedAt),
            sql`${schema.umpeRuleImpacts.runId} <> ${run.id}`,
            inArray(
              schema.umpeRuleImpacts.missionId,
              tx
                .select({ id: schema.umpeRuleImpacts.missionId })
                .from(schema.umpeRuleImpacts)
                .where(eq(schema.umpeRuleImpacts.runId, run.id)),
            ),
          ),
        )
        .returning({ id: schema.umpeRuleImpacts.id });
      await cancelNotes(
        tx,
        superseded.map((row) => row.id),
      );
    }
    await tx
      .update(schema.umpeRuleImpactRuns)
      .set({ assessedAt: now, casesFlagged: flagged })
      .where(eq(schema.umpeRuleImpactRuns.id, run.id));
    await appendAuditEvent(tx, {
      eventType: 'RULE_IMPACT_ASSESSED',
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: run.packVersionId,
      metadata: { casesFlagged: flagged, published: version?.status === 'PUBLISHED' },
    });
    return flagged;
  });
}

function rowCount(result: unknown): number {
  if (result && typeof result === 'object') {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows.length;
    const affected = (result as { affectedRows?: unknown; rowCount?: unknown }).affectedRows;
    if (typeof affected === 'number') return affected;
    const count = (result as { rowCount?: unknown }).rowCount;
    if (typeof count === 'number') return count;
  }
  return 0;
}

/** Cancels the still-queued notes about these impacts (their resource id is the impact's id). */
async function cancelNotes(tx: Db, impactIds: readonly string[]): Promise<void> {
  if (impactIds.length === 0) return;
  await tx
    .update(schema.notifications)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(schema.notifications.eventType, RULE_CHANGED_EVENT),
        eq(schema.notifications.status, 'QUEUED'),
        inArray(schema.notifications.resourceId, [...impactIds]),
      ),
    );
}

/**
 * Queues at most `limit` notes for the run's flagged cases that have none yet. A case that is no
 * longer active or no longer pinned to the older version gets none: its impact is closed instead.
 */
async function queueNotes(
  db: Db,
  run: RunRow,
  limit: number,
  now: Date,
): Promise<{ readonly queued: number; readonly more: boolean }> {
  if (limit <= 0) return { queued: 0, more: true };
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        impact: schema.umpeRuleImpacts,
        mission: {
          id: schema.missions.id,
          applicantId: schema.missions.applicantId,
          packVersionId: schema.missions.packVersionId,
          state: schema.missions.state,
          purgedAt: schema.missions.purgedAt,
        },
        ownerAccountId: schema.applicants.ownerAccountId,
      })
      .from(schema.umpeRuleImpacts)
      .innerJoin(schema.missions, eq(schema.missions.id, schema.umpeRuleImpacts.missionId))
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
      .where(
        and(
          eq(schema.umpeRuleImpacts.runId, run.id),
          eq(schema.umpeRuleImpacts.subjectKind, 'CASE'),
          isNull(schema.umpeRuleImpacts.notifiedAt),
          isNull(schema.umpeRuleImpacts.resolvedAt),
        ),
      )
      .orderBy(asc(schema.umpeRuleImpacts.id))
      .limit(limit + 1)
      .for('update', { of: schema.umpeRuleImpacts, skipLocked: true });
    const page = rows.slice(0, limit);
    let queued = 0;
    const gone: string[] = [];
    for (const row of page) {
      const stillApplies =
        row.mission.purgedAt === null &&
        !(INACTIVE_CASE_STATES as readonly string[]).includes(row.mission.state) &&
        row.mission.packVersionId === row.impact.previousPackVersionId;
      if (!stillApplies) {
        gone.push(row.impact.id);
        continue;
      }
      await enqueueNotificationBothChannels(tx, {
        eventType: RULE_CHANGED_EVENT,
        resourceId: row.impact.id,
        recipientAccountId: row.ownerAccountId,
        applicantId: row.mission.applicantId,
        missionId: row.mission.id,
        payload: {
          subject: 'A checklist for one of your trips was updated',
          summary: `${ruleChangeSentence(impactItem(row.impact))} Review it before you share anything. Nothing in your trip was changed.`,
          deepLinkPath: `/app/mission/${row.mission.id}#trip-package`,
        },
      });
      await tx
        .update(schema.umpeRuleImpacts)
        .set({ notifiedAt: now })
        .where(eq(schema.umpeRuleImpacts.id, row.impact.id));
      queued++;
    }
    if (gone.length > 0) {
      await tx
        .update(schema.umpeRuleImpacts)
        .set({ resolvedAt: now, resolution: 'NO_LONGER_APPLIES' })
        .where(inArray(schema.umpeRuleImpacts.id, gone));
    }
    if (queued > 0) {
      await tx
        .update(schema.umpeRuleImpactRuns)
        .set({ notesQueued: sql`${schema.umpeRuleImpactRuns.notesQueued} + ${queued}` })
        .where(eq(schema.umpeRuleImpactRuns.id, run.id));
    }
    return { queued, more: rows.length > limit };
  });
}

/** The stored precise item of one impact, as the note describes it. */
function impactItem(impact: typeof schema.umpeRuleImpacts.$inferSelect): RuleChangeItem {
  const kinds: readonly RuleChangeKind[] = ['ADDED', 'CHANGED', 'REMOVED', 'NONE'];
  const changeKind = kinds.find((k) => k === impact.changeKind) ?? 'NONE';
  return {
    changeKind,
    itemKind:
      impact.itemKind === 'FIELD' || impact.itemKind === 'DOCUMENT' ? impact.itemKind : null,
    itemKey: impact.itemKey,
    changedCount: impact.changedCount,
  };
}

async function processRun(
  db: Db,
  run: RunRow,
  noteBudget: number,
  now: Date,
): Promise<{ flagged: number; queued: number; more: boolean }> {
  const flagged = run.assessedAt === null ? await flagCases(db, run.id, now) : 0;
  const notes = await queueNotes(db, run, noteBudget, now);
  return { flagged, queued: notes.queued, more: notes.more };
}

/**
 * Right after a version is published (pack management staff): flags the affected active cases and
 * queues up to RULE_IMPACT_NOTE_LIMIT notes. The scheduled sweep finishes anything left.
 */
export async function assessRuleImpact(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  input: { readonly packVersionId: string },
  now: Date = new Date(),
): Promise<Result<RuleImpactProgress, ServiceError>> {
  if (!StaffScope.isGenuine(staff) || staff.platformAction !== 'PACK_MANAGE') {
    return err(serviceError('forbidden', 'Not authorized.'));
  }
  if (!isUuid(input.packVersionId)) return err(serviceError('not_found', 'Version not found.'));
  if (!(await ruleImpactTablesPresent(db))) return ok(NO_PROGRESS);
  const run = first(
    await db
      .select()
      .from(schema.umpeRuleImpactRuns)
      .where(eq(schema.umpeRuleImpactRuns.packVersionId, input.packVersionId))
      .limit(1),
  );
  if (!run) return ok(NO_PROGRESS);
  const done = await processRun(db, run, RULE_IMPACT_NOTE_LIMIT, now);
  return ok({ runs: 1, casesFlagged: done.flagged, notesQueued: done.queued, more: done.more });
}

/**
 * The scheduled safety net: assesses runs nobody assessed yet and queues notes still waiting,
 * oldest run first, at most `limit` notes in all.
 */
export async function sweepRuleImpacts(
  scope: SystemScope<'process-notification-sweeps'>,
  db: Db,
  options: { readonly limit?: number; readonly now?: Date } = {},
): Promise<RuleImpactProgress> {
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-notification-sweeps') {
    return NO_PROGRESS;
  }
  if (!(await ruleImpactTablesPresent(db))) return NO_PROGRESS;
  const now = options.now ?? new Date();
  let budget = Math.min(
    Math.max(1, Math.floor(options.limit ?? RULE_IMPACT_NOTE_LIMIT)),
    RULE_IMPACT_NOTE_LIMIT,
  );
  const waiting: SQL = sql`exists (select 1 from ${schema.umpeRuleImpacts} i where i.run_id = ${schema.umpeRuleImpactRuns.id} and i.notified_at is null and i.resolved_at is null)`;
  const runs = await db
    .select()
    .from(schema.umpeRuleImpactRuns)
    .where(or(isNull(schema.umpeRuleImpactRuns.assessedAt), waiting))
    .orderBy(asc(schema.umpeRuleImpactRuns.createdAt), asc(schema.umpeRuleImpactRuns.id))
    .limit(20);
  let flagged = 0;
  let queued = 0;
  let more = false;
  let looked = 0;
  for (const run of runs) {
    if (budget <= 0) {
      more = true;
      break;
    }
    looked++;
    const done = await processRun(db, run, budget, now);
    flagged += done.flagged;
    queued += done.queued;
    budget -= done.queued;
    if (done.more) more = true;
  }
  return { runs: looked, casesFlagged: flagged, notesQueued: queued, more };
}

// --- For pack editors --------------------------------------------------------------------------------

export interface RuleImpactRunView {
  readonly packVersionId: string;
  readonly packId: string;
  readonly packName: string;
  readonly version: number;
  readonly publishedAt: Date | null;
  readonly assessedAt: Date | null;
  readonly casesFlagged: number;
  readonly notesQueued: number;
  /** Flagged cases still open (not superseded, still active and pinned when last checked). */
  readonly stillOpen: number;
}

/** The latest publications and how many active cases each one flagged. Counts only. */
export async function listRuleImpactRuns(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  limit = 10,
): Promise<Result<readonly RuleImpactRunView[], ServiceError>> {
  if (!StaffScope.isGenuine(staff) || staff.platformAction !== 'PACK_MANAGE') {
    return err(serviceError('forbidden', 'Not authorized.'));
  }
  if (!(await ruleImpactTablesPresent(db))) return ok([]);
  const r = schema.umpeRuleImpactRuns;
  const rows = await db
    .select({
      packVersionId: r.packVersionId,
      packId: r.packId,
      packName: schema.packs.name,
      version: schema.packVersions.version,
      publishedAt: schema.packVersions.publishedAt,
      assessedAt: r.assessedAt,
      casesFlagged: r.casesFlagged,
      notesQueued: r.notesQueued,
      stillOpen: sql<number>`(select count(*)::int from ${schema.umpeRuleImpacts} i where i.run_id = ${r.id} and i.resolved_at is null)`,
    })
    .from(r)
    .innerJoin(schema.packVersions, eq(schema.packVersions.id, r.packVersionId))
    .innerJoin(schema.packs, eq(schema.packs.id, r.packId))
    .orderBy(desc(r.createdAt), desc(r.id))
    .limit(Math.min(Math.max(1, Math.floor(limit)), 50));
  return ok(rows.map((row) => ({ ...row, stillOpen: Number(row.stillOpen) })));
}

// --- For the agency, on its own request ------------------------------------------------------------

export interface CollectionRuleImpact {
  readonly packName: string;
  /** The version the request follows now (its working checklist, else its latest issue). */
  readonly pinnedVersion: number;
  readonly newerVersion: number;
  readonly newerPackVersionId: string;
  readonly item: RuleChangeItem;
  /** The working checklist still follows the older version (reissuing would need a new choice). */
  readonly draftPinned: boolean;
  /** The latest issued revision follows the older version; it stays exactly as issued. */
  readonly issuedPinned: boolean;
}

/**
 * Whether a newer official checklist was published than the one an open request follows, with
 * its one precise item. Read through the agency's own scope; nothing is written, and an issued
 * revision is never changed. Null when nothing newer applies (or the request is not this agency's,
 * which looks the same).
 */
export async function collectionRuleImpact(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
): Promise<Result<CollectionRuleImpact | null, ServiceError>> {
  const problem = agencyCollectionScopeProblem(scope);
  if (problem) return err(problem);
  if (!isUuid(requestId)) return ok(null);
  const request = first(
    await db
      .select({
        id: schema.agencyCollectionRequests.id,
        status: schema.agencyCollectionRequests.status,
        draftPackVersionId: schema.agencyCollectionRequests.draftPackVersionId,
      })
      .from(schema.agencyCollectionRequests)
      .where(
        and(
          eq(schema.agencyCollectionRequests.id, requestId),
          eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
          notInArray(schema.agencyCollectionRequests.status, ['REVOKED', 'CLOSED']),
        ),
      )
      .limit(1),
  );
  if (!request) return ok(null);
  const latestRevision = first(
    await db
      .select({ packVersionId: schema.agencyCollectionRequestRevisions.packVersionId })
      .from(schema.agencyCollectionRequestRevisions)
      .where(eq(schema.agencyCollectionRequestRevisions.requestId, request.id))
      .orderBy(desc(schema.agencyCollectionRequestRevisions.revisionNo))
      .limit(1),
  );
  const issuedId = latestRevision?.packVersionId ?? null;
  const pinnedId = request.draftPackVersionId ?? issuedId;
  if (!pinnedId) return ok(null);
  const pinned = first(
    await db
      .select({
        packId: schema.packVersions.packId,
        version: schema.packVersions.version,
        packName: schema.packs.name,
      })
      .from(schema.packVersions)
      .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
      .where(eq(schema.packVersions.id, pinnedId))
      .limit(1),
  );
  if (!pinned) return ok(null);
  const newest = first(
    await db
      .select({ id: schema.packVersions.id, version: schema.packVersions.version })
      .from(schema.packVersions)
      .where(
        and(
          eq(schema.packVersions.packId, pinned.packId),
          eq(schema.packVersions.status, 'PUBLISHED'),
        ),
      )
      .orderBy(desc(schema.packVersions.version))
      .limit(1),
  );
  if (!newest || newest.version <= pinned.version) return ok(null);
  const diff = await diffPackVersions(db, pinnedId, newest.id);
  if (!diff.ok) return ok(null);
  return ok({
    packName: pinned.packName,
    pinnedVersion: pinned.version,
    newerVersion: newest.version,
    newerPackVersionId: newest.id,
    item: preciseRuleChange(diff.value.entries),
    draftPinned: request.draftPackVersionId === pinnedId,
    issuedPinned: issuedId !== null && issuedId !== newest.id,
  });
}
