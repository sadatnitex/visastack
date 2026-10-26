import type { MissionId } from '@visastack/core';
import {
  type SQL,
  type SQLWrapper,
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { appendAuditEvent } from '../audit';
import type { Db } from '../db';
import { first, schema } from '../db';

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
 * Only "present" is remembered, per database handle: the table is never
 * dropped once created (no down-migration), so a remembered "present" cannot
 * go stale, while "missing" is asked again every time.
 */

/**
 * The relation the presence check looks for, unqualified, so `to_regclass`
 * resolves it through the search path exactly as the queries below do.
 */
const EXCLUSIONS_RELATION = 'grant_case_exclusions';

/** Database handles that have already shown the table exists. */
const PRESENT = new WeakSet<object>();

/** Whether migration 0090 has created `grant_case_exclusions` on this database. */
export async function caseExclusionsTablePresent(db: Db): Promise<boolean> {
  if (PRESENT.has(db)) return true;
  const rows = await db
    .select({ present: sql<boolean>`to_regclass(${EXCLUSIONS_RELATION}::text) is not null` })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) PRESENT.add(db);
  return present;
}

/**
 * Serialises every change to who can reach one person's cases, for the rest
 * of the current transaction: recording the answers for a new case, accepting
 * a sharing invitation, and creating an all-cases grant or invitation. Without
 * it, answers recorded against an invitation while it is being accepted could
 * land after acceptance copied the invitation's exceptions (the "no" would be
 * lost), and a carried-forward exception could miss a "no" written at the same
 * moment. A transaction-scoped advisory lock: released on commit or rollback,
 * re-entrant inside one transaction, and only ever blocks the same person's
 * sharing changes. It must be taken inside a transaction, before reading any
 * grant or invitation it protects, and before the first `appendAuditEvent`
 * of that transaction: the audit trail has one global lock, so taking the two
 * in the opposite order in two transactions would deadlock. `createMission`
 * takes it first for the same reason (answers run in its transaction).
 */
export async function lockCaseSharing(tx: Db, applicantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${caseSharingLockKey(applicantId)}))`);
}

/** The text the advisory lock key is hashed from: one key per person. */
export function caseSharingLockKey(applicantId: string): string {
  return `visastack:case-sharing:${applicantId}`;
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
  readonly createdByAccountId: string | null;
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
      createdByAccountId: table.createdByAccountId,
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

// --- Recipient-level view (ADR 0017 amendment, 26 Oct 2026) -----------------
//
// Exceptions follow the RECIPIENT, not one grant row: a new all-cases grant or
// invitation to someone who already has exceptions inherits them (sharing.ts
// `carryRecipientCaseExceptions`), and the owner is told a case is not shared
// with someone only when none of that recipient's live grants reaches it.

/** Grant statuses that can still reach anything, now or after acceptance or resuming. */
export const LIVE_GRANT_STATUSES = ['ACTIVE', 'PAUSED', 'PENDING_ACCEPTANCE'] as const;

/** The grant facts the recipient-level rule needs. */
export interface RecipientGrantFacts {
  readonly id: string;
  readonly recipientAccountId: string | null;
  readonly recipientOrganizationId: string | null;
  readonly missionId: string | null;
  readonly status: string;
  readonly expiryAt: Date | null;
}

/** Whether a grant can still reach anything: live status and not expired. */
export function isLiveGrant(grant: RecipientGrantFacts, now: Date): boolean {
  return (
    (LIVE_GRANT_STATUSES as readonly string[]).includes(grant.status) &&
    (grant.expiryAt === null || grant.expiryAt.getTime() > now.getTime())
  );
}

/** One key per recipient: the organization, the person, or a person named inside an organization. */
export function recipientKeyOf(grant: RecipientGrantFacts): string {
  return `${grant.recipientOrganizationId ?? '-'}|${grant.recipientAccountId ?? '-'}`;
}

/**
 * Whether any live grant of the same recipient as `grant` reaches `missionId`
 * by case scope: a grant for that case, or an all-cases grant with no
 * exception for it. `exclusions` holds every grant-bound exception of the
 * person (grant id and case id).
 */
export function recipientReachesCase(
  grants: readonly RecipientGrantFacts[],
  exclusions: ReadonlyArray<{ readonly grantId: string | null; readonly missionId: string }>,
  grant: RecipientGrantFacts,
  missionId: string,
  now: Date,
): boolean {
  const key = recipientKeyOf(grant);
  return grants.some(
    (other) =>
      recipientKeyOf(other) === key &&
      isLiveGrant(other, now) &&
      (other.missionId === missionId ||
        (other.missionId === null &&
          !exclusions.some((e) => e.grantId === other.id && e.missionId === missionId))),
  );
}

/**
 * For an organization's own past records about one case (its evidence
 * requests, the notices in its members' bells): visible when one of the
 * organization's LIVE grants on the person (`LIVE_GRANT_STATUSES`, not
 * expired) reaches the case by case scope, or when it holds no live grant on
 * the person at all (then the records stay as history, as before exceptions
 * existed). So an exception, or an ended grant replaced by one that does not
 * reach the case, hides them; an organization whose sharing simply ended
 * keeps its history. `covers` comes from `withCaseExclusions`.
 */
export function orgCaseRecordVisibleSql(
  covers: CaseCoverage,
  input: {
    readonly organizationId: SQLWrapper | string;
    readonly applicantId: SQLWrapper | string;
    readonly missionId: SQLWrapper | string;
    readonly now: Date;
  },
): SQL {
  const grants = schema.grants;
  const live = and(
    eq(grants.recipientOrganizationId, input.organizationId),
    eq(grants.applicantId, input.applicantId),
    inArray(grants.status, [...LIVE_GRANT_STATUSES]),
    or(isNull(grants.expiryAt), gt(grants.expiryAt, input.now)),
  );
  return sql`(exists (select 1 from ${grants} where ${live} and ${covers(input.missionId)}) or not exists (select 1 from ${grants} where ${live}))`;
}

/** Where a new all-cases grant or invitation may inherit exceptions from. */
export type CarryTarget =
  | {
      readonly kind: 'grant';
      readonly id: string;
      readonly recipientAccountId: string | null;
      readonly recipientOrganizationId: string | null;
    }
  | { readonly kind: 'sharing_invitation'; readonly id: string; readonly email: string };

/**
 * The other grants and invitations of one person's record given to the same
 * recipient as `target`, live or not: the same organization; or the same
 * person, matched by account and by the email an invitation was sent to.
 */
export async function recipientExceptionSources(
  tx: Db,
  applicantId: string,
  target: CarryTarget,
): Promise<{
  readonly grants: ReadonlyArray<typeof schema.grants.$inferSelect>;
  readonly invitations: ReadonlyArray<typeof schema.sharingInvitations.$inferSelect>;
}> {
  const grants = schema.grants;
  const invitations = schema.sharingInvitations;
  if (target.kind === 'grant' && target.recipientOrganizationId !== null) {
    const rows = await tx
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.applicantId, applicantId),
          eq(grants.recipientOrganizationId, target.recipientOrganizationId),
        ),
      );
    return { grants: rows.filter((g) => g.id !== target.id), invitations: [] };
  }
  let accountIds: string[];
  let email: string | null;
  if (target.kind === 'grant') {
    if (target.recipientAccountId === null) return { grants: [], invitations: [] };
    accountIds = [target.recipientAccountId];
    const account = first(
      await tx
        .select({ email: schema.accounts.email })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, target.recipientAccountId))
        .limit(1),
    );
    email = account?.email?.trim().toLowerCase() || null;
  } else {
    email = target.email;
    accountIds = (
      await tx
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(sql`lower(${schema.accounts.email}) = ${email}`)
    ).map((a) => a.id);
  }
  const grantRows =
    accountIds.length > 0
      ? await tx
          .select()
          .from(grants)
          .where(
            and(
              eq(grants.applicantId, applicantId),
              isNull(grants.recipientOrganizationId),
              inArray(grants.recipientAccountId, accountIds),
            ),
          )
      : [];
  const invitationRows =
    email !== null
      ? await tx
          .select()
          .from(invitations)
          .where(and(eq(invitations.applicantId, applicantId), eq(invitations.email, email)))
      : [];
  return {
    grants: grantRows.filter((g) => !(target.kind === 'grant' && g.id === target.id)),
    invitations: invitationRows.filter(
      (i) => !(target.kind === 'sharing_invitation' && i.id === target.id),
    ),
  };
}

/**
 * Exceptions follow the recipient (ADR 0017 amendment, 26 Oct 2026): a new
 * all-cases grant or all-cases invitation given to someone who already has
 * exceptions on this person's cases, under an earlier grant or invitation
 * (live or ended), inherits every one of them, so sharing all cases again can
 * never silently reopen a case the owner said no to. A grant for one named
 * case is an explicit share of that case and is never narrowed. A case the
 * recipient organization runs for the person (`owner_organization_id`) is not
 * carried. Each row written is audited as GRANT_CASE_EXCLUDED with the reason
 * `carried_forward`. Call inside the creating transaction, after
 * `lockCaseSharing`. Returns how many exceptions were written.
 */
export async function carryRecipientCaseExceptions(
  tx: Db,
  input: {
    readonly applicantId: string;
    readonly actorAccountId: string;
    readonly target: CarryTarget;
  },
): Promise<number> {
  if (!(await caseExclusionsTablePresent(tx))) return 0;
  const sources = await recipientExceptionSources(tx, input.applicantId, input.target);
  const grantIds = sources.grants.map((g) => g.id);
  const invitationIds = sources.invitations.map((i) => i.id);
  if (grantIds.length + invitationIds.length === 0) return 0;
  const exclusions = schema.grantCaseExclusions;
  const rows = await tx
    .selectDistinct({
      missionId: exclusions.missionId,
      ownerOrganizationId: schema.missions.ownerOrganizationId,
    })
    .from(exclusions)
    .innerJoin(schema.missions, eq(schema.missions.id, exclusions.missionId))
    .where(
      and(
        eq(exclusions.applicantId, input.applicantId),
        or(
          grantIds.length > 0 ? inArray(exclusions.grantId, grantIds) : undefined,
          invitationIds.length > 0
            ? inArray(exclusions.sharingInvitationId, invitationIds)
            : undefined,
        ),
      ),
    );
  const target = input.target;
  const owningOrganization = target.kind === 'grant' ? target.recipientOrganizationId : null;
  const missionIds = rows
    .filter((r) => owningOrganization === null || r.ownerOrganizationId !== owningOrganization)
    .map((r) => r.missionId);
  if (missionIds.length === 0) return 0;
  const inserted = await tx
    .insert(exclusions)
    .values(
      missionIds.map((missionId) => ({
        grantId: target.kind === 'grant' ? target.id : null,
        sharingInvitationId: target.kind === 'sharing_invitation' ? target.id : null,
        missionId,
        applicantId: input.applicantId,
        createdByAccountId: input.actorAccountId,
      })),
    )
    .onConflictDoNothing()
    .returning({ missionId: exclusions.missionId });
  for (const row of inserted) {
    await appendAuditEvent(tx, {
      eventType: 'GRANT_CASE_EXCLUDED',
      actorAccountId: input.actorAccountId,
      action: 'SHARE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      missionId: row.missionId,
      grantId: target.kind === 'grant' ? target.id : null,
      resourceType: target.kind,
      resourceId: target.id,
      reason: 'carried_forward',
    });
  }
  return inserted.length;
}
