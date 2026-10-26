import type { MissionId } from '@visastack/core';
import { type SQL, type SQLWrapper, and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { schema } from '../db';

/**
 * Per-case sharing exceptions (ADR 0017; permission-model law 9).
 *
 * An all-cases grant (`grants.mission_id IS NULL`) covers every case of the
 * applicant except the ones its owner excluded from it in
 * `grant_case_exclusions`. There is one rule for that, in two forms:
 *
 * - `grantCoversMission` (packages/policy) for the policy engine, fed by
 *   `loadCaseExclusions` below through `loadGrantsForPolicy`, so
 *   `requireAccess`, `orgGrantPermits` and everything built on them inherit it;
 * - `grantCoversCaseSql` below, for list queries that join grants to cases in
 *   SQL. `grant-scope.test.ts` proves the two agree on every combination.
 *
 * The table may not exist yet: application code goes live minutes before
 * migration 0090 runs. Reads then mean "no exceptions", which is exact, since
 * no exception can have been written without the table. Writes refuse instead
 * (`caseExclusionsTablePresent` is checked by the write side), so a "no" is
 * never lost. Presence is checked with `to_regclass`, which never raises, so
 * an outer transaction is never aborted and concurrent queries on the same
 * connection are never disturbed. Any other failure throws (fail closed).
 * Nothing is cached: every call asks the database.
 */

/** The relation the presence check looks for, schema-qualified like the migrations. */
const EXCLUSIONS_RELATION = 'public.grant_case_exclusions';

/** Whether migration 0090 has created `grant_case_exclusions` on this database. */
export async function caseExclusionsTablePresent(db: Db): Promise<boolean> {
  const rows = await db
    .select({ present: sql<boolean>`to_regclass(${EXCLUSIONS_RELATION}::text) is not null` })
    .from(sql`(select 1) as probe`);
  return rows[0]?.present === true;
}

/** Excluded case ids per grant id. A grant with no exceptions has no entry. */
export type CaseExclusionsByGrant = ReadonlyMap<string, readonly MissionId[]>;

const NONE: CaseExclusionsByGrant = new Map();

/**
 * The exceptions recorded against accepted grants, for every grant of one
 * applicant or for the named grants. Invitation-bound exceptions are not
 * included (they bind no live access until the invitation is accepted).
 */
export async function loadCaseExclusions(
  db: Db,
  scope: { readonly applicantId: string } | { readonly grantIds: readonly string[] },
): Promise<CaseExclusionsByGrant> {
  if ('grantIds' in scope && scope.grantIds.length === 0) return NONE;
  if (!(await caseExclusionsTablePresent(db))) return NONE;
  const table = schema.grantCaseExclusions;
  const rows = await db
    .select({ grantId: table.grantId, missionId: table.missionId })
    .from(table)
    .where(
      and(
        isNotNull(table.grantId),
        'applicantId' in scope
          ? eq(table.applicantId, scope.applicantId)
          : inArray(table.grantId, [...new Set(scope.grantIds)]),
      ),
    );
  const byGrant = new Map<string, MissionId[]>();
  for (const row of rows) {
    if (row.grantId === null) continue;
    const list = byGrant.get(row.grantId) ?? [];
    list.push(row.missionId as MissionId);
    byGrant.set(row.grantId, list);
  }
  return byGrant;
}

/** Excluded case ids per pending invitation id, for the named invitations. */
export async function loadInvitationCaseExclusions(
  db: Db,
  invitationIds: readonly string[],
): Promise<CaseExclusionsByGrant> {
  if (invitationIds.length === 0) return NONE;
  if (!(await caseExclusionsTablePresent(db))) return NONE;
  const table = schema.grantCaseExclusions;
  const rows = await db
    .select({ invitationId: table.sharingInvitationId, missionId: table.missionId })
    .from(table)
    .where(inArray(table.sharingInvitationId, [...new Set(invitationIds)]));
  const byInvitation = new Map<string, MissionId[]>();
  for (const row of rows) {
    if (row.invitationId === null) continue;
    const list = byInvitation.get(row.invitationId) ?? [];
    list.push(row.missionId as MissionId);
    byInvitation.set(row.invitationId, list);
  }
  return byInvitation;
}

/** One recorded exception with its case title, for the owner's own views. */
export interface CaseExclusionDetail {
  readonly id: string;
  readonly grantId: string | null;
  readonly sharingInvitationId: string | null;
  readonly missionId: string;
  readonly missionTitle: string;
  readonly createdAt: Date;
}

/**
 * Every exception recorded on one applicant's grants and invitations, with
 * the case title, oldest first. For owner-facing transparency only: callers
 * must already have proved the actor owns the applicant.
 */
export async function listCaseExclusionsForApplicant(
  db: Db,
  applicantId: string,
): Promise<readonly CaseExclusionDetail[]> {
  if (!(await caseExclusionsTablePresent(db))) return [];
  const table = schema.grantCaseExclusions;
  return db
    .select({
      id: table.id,
      grantId: table.grantId,
      sharingInvitationId: table.sharingInvitationId,
      missionId: table.missionId,
      missionTitle: schema.missions.title,
      createdAt: table.createdAt,
    })
    .from(table)
    .innerJoin(
      schema.missions,
      and(
        eq(schema.missions.id, table.missionId),
        eq(schema.missions.applicantId, table.applicantId),
      ),
    )
    .where(eq(table.applicantId, applicantId))
    .orderBy(asc(table.createdAt), asc(table.id));
}

/** Builds the case-coverage condition for one case expression (a column or a case id). */
export type CaseCoverage = (missionId: SQLWrapper | string) => SQL;

/**
 * The SQL form of `grantCoversMission`: true when the `grants` row in the
 * surrounding query reaches the case `missionId` by case scope alone. Status,
 * time window and recipient are the caller's own conditions, exactly as
 * `evaluateGrant` judges them separately. The surrounding query must select
 * from `grants` without an alias.
 *
 * `exclusions: false` is only for a database where the table is missing; use
 * `withCaseExclusions` rather than choosing by hand.
 */
export function grantCoversCaseSql(
  missionId: SQLWrapper | string,
  options: { readonly exclusions: boolean },
): SQL {
  const grants = schema.grants;
  if (!options.exclusions) {
    return sql`(${grants.missionId} = ${missionId} or ${grants.missionId} is null)`;
  }
  const exclusions = schema.grantCaseExclusions;
  return sql`(${grants.missionId} = ${missionId} or (${grants.missionId} is null and not exists (select 1 from ${exclusions} where ${exclusions.grantId} = ${grants.id} and ${exclusions.missionId} = ${missionId})))`;
}

/**
 * Runs `run` with the case-coverage condition that fits this database: the
 * full rule when `grant_case_exclusions` exists, the plain case-scope rule
 * when it does not (no exception can exist then). One presence check per call.
 */
export async function withCaseExclusions<T>(
  db: Db,
  run: (covers: CaseCoverage) => Promise<T>,
): Promise<T> {
  const exclusions = await caseExclusionsTablePresent(db);
  return run((missionId) => grantCoversCaseSql(missionId, { exclusions }));
}
