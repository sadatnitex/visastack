import {
  type AccountId,
  type AgencyId,
  type ApplicantId,
  type DocumentId,
  type MissionId,
  PERMISSION_ACTIONS,
  type PermissionAction,
} from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import { isSharingCategory } from '@visastack/core/catalogue/packs';
import {
  type Actor as PolicyActor,
  type Grant as PolicyGrant,
  STEP_UP_ACTIONS,
  authorize,
  grantCoversMission,
} from '@visastack/policy';
import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import {
  LIVE_GRANT_STATUSES,
  carryRecipientCaseExceptions,
  caseExclusionsTablePresent,
  isLiveGrant,
  listCaseExclusionsForApplicant,
  loadCaseExclusions,
  lockCaseSharing,
  recipientExceptionSources,
  recipientReachesCase,
} from './access/grant-scope';
import { AuthorizedApplicant } from './access/require-access';
import { StepUpProof } from './access/step-up-proof';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  everydayDocumentCondition,
  lifecycleTablesPresent,
  presentApplicantCondition,
  presentDocumentCondition,
} from './lifecycle/foundation';
import { recordProductEvent } from './product-events';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';

/**
 * Sharing — scoped, accepted, time-limited grants (Build Spec §4.4; PRD §5).
 *
 * A grant is the ONLY way access crosses tenants. The applicant owner creates
 * it (purpose-bound, action-scoped, optionally mission/category/document-scoped
 * and time limited); it takes effect only once the recipient accepts, and is
 * revocable at any time. The policy engine consumes these rows; this service
 * manages their lifecycle and gives the owner full access transparency.
 */

export type Grant = typeof schema.grants.$inferSelect;

/**
 * One grant row in the policy engine's shape, with the cases excluded from it
 * (per-case sharing exceptions, ADR 0017). The only mapping from a grant row
 * to a policy grant: every caller that evaluates a grant row uses this, so no
 * scope facet can be dropped by a hand-copied variant.
 */
export function toPolicyGrant(row: Grant, excludedMissionIds?: readonly MissionId[]): PolicyGrant {
  return {
    applicantId: row.applicantId as ApplicantId,
    actions: row.actions as PermissionAction[],
    purpose: row.purpose,
    status: row.status,
    startAt: row.startAt.toISOString(),
    ...(row.recipientAccountId ? { recipientAccountId: row.recipientAccountId as AccountId } : {}),
    ...(row.recipientOrganizationId
      ? { recipientOrganizationId: row.recipientOrganizationId as AgencyId }
      : {}),
    ...(row.missionId ? { missionId: row.missionId as MissionId } : {}),
    ...(!row.missionId && excludedMissionIds && excludedMissionIds.length > 0
      ? { excludedMissionIds: [...excludedMissionIds] }
      : {}),
    ...(row.categories ? { categories: row.categories } : {}),
    ...(row.documentIds ? { documentIds: row.documentIds as DocumentId[] } : {}),
    ...(row.documentScopeSnapshot
      ? { categoryScopeDocumentIds: row.documentScopeSnapshot as DocumentId[] }
      : {}),
    ...(row.acceptedAt ? { acceptedAt: row.acceptedAt.toISOString() } : {}),
    ...(row.expiryAt ? { expiryAt: row.expiryAt.toISOString() } : {}),
  };
}

/**
 * Map the grant rows for an applicant into the policy engine's Grant shape,
 * each with its per-case sharing exceptions, read live (never cached).
 */
export async function loadGrantsForPolicy(db: Db, applicantId: string): Promise<PolicyGrant[]> {
  const rows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  const exclusions = rows.some((row) => row.missionId === null)
    ? await loadCaseExclusions(db, { applicantId })
    : undefined;
  return rows.map((row) => toPolicyGrant(row, exclusions?.get(row.id)));
}

async function ownsApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<boolean> {
  const applicant = await getApplicant(db, applicantId);
  return applicant !== undefined && applicant.ownerAccountId === actorAccountId;
}

export interface CreateGrantInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly recipientAccountId?: string;
  readonly recipientOrganizationId?: string;
  readonly actions: readonly PermissionAction[];
  readonly purpose: string;
  readonly categories?: readonly string[];
  readonly documentIds?: readonly string[];
  readonly missionId?: string;
  readonly expiryAt?: Date;
  /**
   * Required `true` when `actions` includes any `STEP_UP_ACTIONS` member
   * (granting `DOWNLOAD_ORIGINAL`/`EXPORT_PROFILE`/`SHARE` is itself a
   * highly sensitive act, independent of anything the recipient later does
   * with it) — see `createGrant`'s doc comment. Optional and ignored for an
   * ordinary grant; never defaults to satisfied.
   */
  readonly stepUpSatisfied?: boolean;
}

/** PRD SHR-01: "maximum initial duration 90 days." No grant may outlive its creation by more than this. */
const GRANT_MAX_DURATION_DAYS = 90;

/** PRD SHR-01: "Default duration is 30 days." Applied when the caller names no expiry at all, so a grant is never silently permanent. */
const GRANT_DEFAULT_DURATION_DAYS = 30;

/**
 * Create a pending, purpose-bound grant (applicant owner only).
 *
 * Hardened per the master recovery directive §7 "PR 2": requires current
 * SHARING consent; exactly one recipient type (not both, not neither); the
 * recipient account/organization must exist (an organization must also be
 * `ACTIVE`, i.e. independently verified — a `PENDING_VERIFICATION` or
 * `SUSPENDED` org can never be granted access); a named mission/documents
 * must actually belong to this applicant; categories must be canonical
 * packs; actions must be canonical `PermissionAction`s; expiry, if given,
 * must be in the future and within `GRANT_MAX_DURATION_DAYS`.
 *
 * PRD SHR-01 (Commercial V1 Part 4): an omitted `expiryAt` no longer means
 * "never expires." Every grant gets a real, bounded expiry:
 * `GRANT_DEFAULT_DURATION_DAYS` when the caller names none, capped at
 * `GRANT_MAX_DURATION_DAYS` either way. Renewal beyond that bound is the
 * owner's own explicit, separate action (accepting a fresh grant), never an
 * initial duration this function will hand out itself.
 *
 * PRD SHR-01 (Commercial V1 Part 4, AD-11): a `categories`-scoped grant is
 * also snapshotted against the applicant's CURRENT documents right here,
 * at creation. That snapshot, not a live category match, is what the
 * policy engine actually checks from now on, so a document uploaded after
 * this call never becomes visible under it automatically; growing it is
 * `expandGrantScope`'s job, an explicit, separately-confirmed owner action.
 *
 * Step-up: creating a grant that hands out a `STEP_UP_ACTIONS` action
 * (`DOWNLOAD_ORIGINAL`, `EXPORT_PROFILE`, `SHARE`) is itself the sensitive
 * act — a hijacked session could otherwise silently grant a hostile
 * recipient standing access with no further check ever required. Such a
 * grant is denied unless `input.stepUpSatisfied` is honestly `true` (master
 * recovery directive §7 "PR 5"; never hardcoded — the caller must derive it
 * from a genuine WorkOS reauthentication, see `apps/web/src/lib/step-up.ts`).
 * An ordinary grant (view/preview/comment-only) needs no step-up.
 */
export async function prepareGrantScope(
  db: Db,
  input: CreateGrantInput,
  recipientRequired = false,
): Promise<
  Result<{ readonly expiryAt: Date; readonly documentScopeSnapshot: string[] | null }, ServiceError>
> {
  if (!(await ownsApplicant(db, input.actorAccountId, input.applicantId))) {
    return err(serviceError('forbidden', 'only the applicant owner can grant access'));
  }
  if (!(await hasConsent(db, input.actorAccountId, 'SHARING'))) {
    return err(
      serviceError('consent_required', 'Sharing consent is required before creating a grant'),
    );
  }
  if (input.recipientAccountId && input.recipientOrganizationId) {
    return err(serviceError('invalid', 'a grant must name exactly one recipient type, not both'));
  }
  if (recipientRequired && !input.recipientAccountId && !input.recipientOrganizationId)
    return err(serviceError('invalid', 'a grant must name a recipient'));
  if (input.actions.length === 0) {
    return err(serviceError('invalid', 'a grant needs at least one action'));
  }
  const invalidAction = input.actions.find(
    (action) => !(PERMISSION_ACTIONS as readonly string[]).includes(action),
  );
  if (invalidAction) return err(serviceError('invalid', `unknown action: ${invalidAction}`));
  // S22: letting an agency's AI tools read is the traveller's own separate choice on an agency
  // grant (`setGrantAiAssist`, with a fresh identity check), never part of making a grant.
  if (input.actions.includes('AI_ASSIST')) {
    return err(
      serviceError('invalid', 'AI tools are allowed on an agency grant itself, after it is made'),
    );
  }
  if (input.actions.some((action) => STEP_UP_ACTIONS.includes(action)) && !input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'granting this level of access requires reauthentication'),
    );
  }
  if (input.purpose.trim().length === 0) {
    return err(serviceError('invalid', 'a purpose is required'));
  }
  if (input.categories) {
    const invalidCategory = input.categories.find((category) => !isSharingCategory(category));
    if (invalidCategory)
      return err(serviceError('invalid', `unknown category: ${invalidCategory}`));
  }
  const now = Date.now();
  if (input.expiryAt && !Number.isFinite(input.expiryAt.getTime()))
    return err(serviceError('invalid', 'expiry must be a valid date'));
  if (input.expiryAt) {
    if (input.expiryAt.getTime() <= now) {
      return err(serviceError('invalid', 'expiry must be in the future'));
    }
    if (input.expiryAt.getTime() > now + GRANT_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000) {
      return err(
        serviceError('invalid', `expiry may be at most ${GRANT_MAX_DURATION_DAYS} days out`),
      );
    }
  }
  // PRD SHR-01: no expiry named by the caller defaults to 30 days, never to
  // permanent access. This is the value actually persisted below.
  const resolvedExpiryAt =
    input.expiryAt ?? new Date(now + GRANT_DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000);

  if (input.recipientAccountId) {
    const recipient = first(
      await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, input.recipientAccountId))
        .limit(1),
    );
    if (!recipient) return err(serviceError('not_found', 'recipient account not found'));
  }
  if (input.recipientOrganizationId) {
    const org = first(
      await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, input.recipientOrganizationId))
        .limit(1),
    );
    if (!org) return err(serviceError('not_found', 'recipient organization not found'));
    if (org.status !== 'ACTIVE') {
      return err(
        serviceError('invalid', 'recipient organization is not an active, verified organization'),
      );
    }
  }
  if (input.missionId) {
    const mission = first(
      await db
        .select()
        .from(schema.missions)
        .where(eq(schema.missions.id, input.missionId))
        .limit(1),
    );
    if (!mission || mission.applicantId !== input.applicantId) {
      return err(serviceError('invalid', 'case does not belong to this applicant'));
    }
  }
  if (input.documentIds && input.documentIds.length > 0) {
    const uniqueIds = [...new Set(input.documentIds)];
    const lifecycle = await lifecycleTablesPresent(db);
    const docs = await db
      .select({ id: schema.documents.id, applicantId: schema.documents.applicantId })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, uniqueIds),
          // Grant document_ids, an explicit choice: presentDocumentCondition (a deleted one is refused).
          lifecycle ? presentDocumentCondition() : undefined,
        ),
      );
    if (docs.length !== uniqueIds.length || docs.some((d) => d.applicantId !== input.applicantId)) {
      return err(serviceError('invalid', 'one or more documents do not belong to this applicant'));
    }
  }

  const rateLimit = await checkRateLimit(
    db,
    { subjectId: input.actorAccountId, action: 'grant.create' },
    RATE_LIMITS.GRANT_CREATE,
  );
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  // PRD SHR-01: a category grant covers only what actually matches those
  // categories right now, snapshotted here, never every document that
  // matches later (AD-11). No categories, nothing to snapshot.
  const documentScopeSnapshot = input.categories
    ? await documentIdsMatchingCategories(db, input.applicantId, input.categories)
    : null;

  return ok({ expiryAt: resolvedExpiryAt, documentScopeSnapshot });
}

export async function createGrant(
  db: Db,
  input: CreateGrantInput,
): Promise<Result<Grant, ServiceError>> {
  const prepared = await prepareGrantScope(db, input, true);
  if (!prepared.ok) return prepared;
  const { expiryAt: resolvedExpiryAt, documentScopeSnapshot } = prepared.value;
  return db.transaction(async (tx) => {
    const allCases = !input.missionId;
    // An all-cases grant takes the person's sharing lock before anything is
    // written, so it cannot interleave with the answers for a new case.
    if (allCases) await lockCaseSharing(tx, input.applicantId);
    const grant = required(
      first(
        await tx
          .insert(schema.grants)
          .values({
            applicantId: input.applicantId,
            recipientAccountId: input.recipientAccountId ?? null,
            recipientOrganizationId: input.recipientOrganizationId ?? null,
            missionId: input.missionId ?? null,
            actions: [...input.actions],
            categories: input.categories ? [...input.categories] : null,
            documentIds: input.documentIds ? [...input.documentIds] : null,
            documentScopeSnapshot,
            purpose: input.purpose.trim(),
            expiryAt: resolvedExpiryAt,
          })
          .returning(),
      ),
      'grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'GRANT_CREATED',
      actorAccountId: input.actorAccountId,
      action: 'SHARE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
      metadata: { purpose: grant.purpose, actions: input.actions.length },
    });
    if (allCases) {
      await carryRecipientCaseExceptions(tx, {
        applicantId: input.applicantId,
        actorAccountId: input.actorAccountId,
        target: {
          kind: 'grant',
          id: grant.id,
          recipientAccountId: grant.recipientAccountId,
          recipientOrganizationId: grant.recipientOrganizationId,
        },
      });
    }
    await recordProductEvent(tx, {
      eventType: 'GRANT_CREATED',
      accountId: input.actorAccountId,
    });
    return ok(grant);
  });
}

async function loadGrant(db: Db, grantId: string): Promise<Grant | undefined> {
  return first(await db.select().from(schema.grants).where(eq(schema.grants.id, grantId)).limit(1));
}

/**
 * Accept a pending grant.
 *
 * For an individual (account) grant: only the exact named account may
 * accept. For an organization grant: only an active OWNER or ADMIN may
 * accept on behalf of the organization — previously any active member of
 * ANY role could (docs/audits/commercial-readiness-recovery-baseline.md
 * §7). Transactionally conditional (compare-and-set on
 * `status = PENDING_ACCEPTANCE`), so two concurrent accept attempts can
 * never both succeed.
 */
export async function acceptGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  const grant = await loadGrant(db, input.grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (grant.status !== 'PENDING_ACCEPTANCE') {
    return err(serviceError('invalid', 'grant is not pending acceptance'));
  }

  const isRecipientAccount = grant.recipientAccountId === input.actorAccountId;
  let isRecipientOrgOwnerOrAdmin = false;
  if (grant.recipientOrganizationId) {
    const m = first(
      await db
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.accountId, input.actorAccountId),
            eq(schema.memberships.organizationId, grant.recipientOrganizationId),
          ),
        )
        .limit(1),
    );
    isRecipientOrgOwnerOrAdmin = m?.active === true && (m.role === 'OWNER' || m.role === 'ADMIN');
  }
  if (!isRecipientAccount && !isRecipientOrgOwnerOrAdmin) {
    return err(
      serviceError(
        'forbidden',
        'only the grant recipient, or an OWNER/ADMIN of the recipient organization, can accept it',
      ),
    );
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.grants)
      .set({ status: 'ACTIVE', acceptedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(schema.grants.id, input.grantId), eq(schema.grants.status, 'PENDING_ACCEPTANCE')),
      )
      .returning();
    const updated = first(rows);
    if (!updated) {
      return err(serviceError('invalid', 'grant is not pending acceptance'));
    }
    await appendAuditEvent(tx, {
      eventType: 'GRANT_ACCEPTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: grant.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
    });
    return ok(updated);
  });
}

/**
 * The grant state machine (master recovery directive §7 "PR 2"):
 *
 * ```
 * PENDING_ACCEPTANCE -> ACTIVE     (acceptGrant, above)
 * PENDING_ACCEPTANCE -> REVOKED
 * ACTIVE             -> PAUSED
 * ACTIVE             -> REVOKED
 * PAUSED             -> ACTIVE
 * PAUSED             -> REVOKED
 * REVOKED            -> terminal
 * EXPIRED            -> terminal
 * ```
 *
 * Each transition below is transactionally conditional: the `UPDATE`'s
 * `WHERE` clause requires the row's CURRENT status to be one of
 * `allowedFrom` at write time (compare-and-set), not merely at an earlier
 * read — closing the gap where `resumeGrant` could previously reactivate an
 * already-`REVOKED` grant (revocation was not actually terminal) and where
 * two concurrent transitions on the same grant could race.
 */
async function ownerTransition(
  db: Db,
  actorAccountId: string,
  grantId: string,
  allowedFrom: readonly Grant['status'][],
  to: Grant['status'],
  eventType: string,
): Promise<Result<Grant, ServiceError>> {
  const grant = await loadGrant(db, grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (!(await ownsApplicant(db, actorAccountId, grant.applicantId))) {
    return err(serviceError('forbidden', 'only the applicant owner can change this grant'));
  }
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.grants)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(schema.grants.id, grantId), inArray(schema.grants.status, allowedFrom)))
      .returning();
    const updated = first(rows);
    if (!updated) {
      return err(
        serviceError('invalid', `grant cannot transition to ${to} from its current status`),
      );
    }
    await appendAuditEvent(tx, {
      eventType,
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: grant.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
    });
    return ok(updated);
  });
}

/** Revoke a grant (applicant owner). Terminal — a revoked grant can never resume. */
export function revokeGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  return ownerTransition(
    db,
    input.actorAccountId,
    input.grantId,
    ['PENDING_ACCEPTANCE', 'ACTIVE', 'PAUSED'],
    'REVOKED',
    'GRANT_REVOKED',
  );
}

/** Pause an active grant (applicant owner). */
export function pauseGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  return ownerTransition(
    db,
    input.actorAccountId,
    input.grantId,
    ['ACTIVE'],
    'PAUSED',
    'GRANT_PAUSED',
  );
}

/**
 * Resume a paused grant (applicant owner). Only reachable from PAUSED -
 * never from REVOKED. SHR-01/SHR-02: "a paused grant may resume only
 * within its original validity" - a grant whose `expiryAt` has already
 * passed while paused cannot be resumed at all, even by its own owner.
 * `authorize()` would deny actual access through it either way (it always
 * re-checks `expiryAt` live), but resuming it anyway would still leave a
 * misleading `status: 'ACTIVE'` row nothing else corrects, so this refuses
 * the transition itself rather than relying on that separate check alone.
 */
export async function resumeGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  const grant = await loadGrant(db, input.grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (grant.expiryAt && grant.expiryAt.getTime() <= Date.now()) {
    return err(serviceError('invalid', 'this grant has already expired and cannot be resumed'));
  }
  return ownerTransition(
    db,
    input.actorAccountId,
    input.grantId,
    ['PAUSED'],
    'ACTIVE',
    'GRANT_RESUMED',
  );
}

/** A grant directed at the current account, resolved with the subject's name. */
export interface IncomingGrant {
  readonly grant: Grant;
  readonly applicantName: string;
}

/**
 * Grants whose recipient is this account (the "shared with you" inbox),
 * newest first. Used to surface pending grants the recipient can accept.
 */
export async function listGrantsForRecipientAccount(
  db: Db,
  accountId: string,
): Promise<IncomingGrant[]> {
  const lifecycle = await lifecycleTablesPresent(db);
  const rows = await db
    .select({ grant: schema.grants, applicantName: schema.applicants.displayName })
    .from(schema.grants)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.grants.applicantId))
    .where(
      and(
        eq(schema.grants.recipientAccountId, accountId),
        // A recipient's view of shared records: presentApplicantCondition (archive never revokes sharing, D6).
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    );
  return [...rows]
    .sort((a, b) => b.grant.createdAt.getTime() - a.grant.createdAt.getTime())
    .map((r) => ({ grant: r.grant, applicantName: r.applicantName }));
}

/** A case one all-cases grant does not cover, because the owner said no for that case (ADR 0017). */
export interface CaseException {
  readonly missionId: string;
  readonly missionTitle: string;
  readonly since: Date;
  /**
   * The same recipient still reaches this case through another live grant
   * (one for this case, or another all-cases grant without this exception).
   * Exceptions follow the recipient, so the owner is not told the case is
   * "Not Shared" with them: it is.
   */
  readonly reachedByAnotherGrant: boolean;
}

/** A grant as its owner sees it, with the cases excluded from it. */
export interface GrantWithExceptions extends Grant {
  /** Cases this all-cases grant does not cover, oldest first. Always empty for a case-scoped grant. */
  readonly caseExceptions: readonly CaseException[];
}

/**
 * Whether one grant, as its owner sees it, reaches one case by case scope
 * alone: the policy engine's `grantCoversMission` on the same `toPolicyGrant`
 * mapping every access check uses. Status and time are the caller's to judge.
 */
export function grantReachesCase(grant: GrantWithExceptions, missionId: string): boolean {
  return grantCoversMission(
    toPolicyGrant(
      grant,
      grant.caseExceptions.map((exception) => exception.missionId as MissionId),
    ),
    missionId as MissionId,
  );
}

/** Access transparency: every grant on an applicant, with its case exceptions (owner only). */
export async function listAccessForApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<GrantWithExceptions[], ServiceError>> {
  if (!(await ownsApplicant(db, actorAccountId, applicantId))) {
    return err(serviceError('forbidden', 'not authorized to view access for this applicant'));
  }
  const rows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  const exceptions = rows.some((row) => row.missionId === null)
    ? await listCaseExclusionsForApplicant(db, applicantId)
    : [];
  const now = new Date();
  return ok(
    rows.map((row) => ({
      ...row,
      caseExceptions:
        row.missionId === null
          ? exceptions
              .filter((e) => e.grantId === row.id)
              .map((e) => ({
                missionId: e.missionId,
                missionTitle: e.missionTitle,
                since: e.createdAt,
                reachedByAnotherGrant: recipientReachesCase(
                  rows,
                  exceptions,
                  row,
                  e.missionId,
                  now,
                ),
              }))
          : [],
    })),
  );
}

/** A grant's recipient, resolved to something a human recognizes rather than a raw id. */
export interface GrantRecipient {
  readonly kind: 'account' | 'organization' | 'unknown';
  readonly label: string;
}

export interface GrantWithRecipient extends GrantWithExceptions {
  readonly recipient: GrantRecipient;
}

/** WP-SB3: how many grants the sharing page asks for at once (`limit`, clamped 1 to 500). */
export interface GrantListOptions {
  readonly limit?: number;
}

/**
 * WP-SB3: the first grants of one record, plus counts over all of them, so the sharing page can
 * show a few grants and still say how many exist and how many hold access right now.
 */
export interface GrantListPage {
  readonly items: GrantWithRecipient[];
  readonly counts: {
    /** Every grant on the record, whatever its state. */
    readonly total: number;
    /** Grants whose status is ACTIVE. */
    readonly active: number;
    /** Active or paused grants that have not ended (the sharing page's Glance list). */
    readonly holdingAccess: number;
    /** How many of the returned grants hold access, judged at the same moment as the above. */
    readonly holdingAccessShown: number;
  };
}

/**
 * Every grant must stay reachable, because each one carries its own Pause and Revoke: the list
 * grows past the usual 100-row page, up to this many. Every grant row is read anyway (see below).
 */
const GRANT_LIST_LIMIT_MAX = 500;

/** A grant that has been revoked, has expired, or whose end date has passed. */
function grantHasEnded(grant: Pick<Grant, 'status' | 'expiryAt'>, now: number): boolean {
  return (
    grant.status === 'REVOKED' ||
    grant.status === 'EXPIRED' ||
    (grant.expiryAt !== null && grant.expiryAt.getTime() <= now)
  );
}

/** 0 holds access now, 1 is waiting to be accepted, 2 has ended: the order the page lists them. */
function grantListRank(grant: Pick<Grant, 'status' | 'expiryAt'>, now: number): number {
  if (grantHasEnded(grant, now)) return 2;
  return grant.status === 'ACTIVE' || grant.status === 'PAUSED' ? 0 : 1;
}

/**
 * Same as `listAccessForApplicant`, but resolves WHO each grant was given to.
 *
 * With `options` (WP-SB3) it returns only the first `limit` grants, in a stable order (holding
 * access, then waiting, then ended; newest first inside each, then by id), with counts over every
 * grant. The same owner check applies, and every grant row is still read, because a grant's
 * per-case exceptions depend on the recipient's other grants; only the recipient lookups, which
 * cost one read per grant, are limited to the grants returned.
 */
export async function listAccessForApplicantDetailed(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<GrantWithRecipient[], ServiceError>>;
export async function listAccessForApplicantDetailed(
  db: Db,
  actorAccountId: string,
  applicantId: string,
  options: GrantListOptions,
): Promise<Result<GrantListPage, ServiceError>>;
export async function listAccessForApplicantDetailed(
  db: Db,
  actorAccountId: string,
  applicantId: string,
  options?: GrantListOptions,
): Promise<Result<GrantWithRecipient[] | GrantListPage, ServiceError>> {
  const listed = await listAccessForApplicant(db, actorAccountId, applicantId);
  if (!listed.ok) return listed;

  if (options === undefined) {
    const result: GrantWithRecipient[] = [];
    for (const grant of listed.value) {
      result.push({ ...grant, recipient: await resolveGrantRecipient(db, grant) });
    }
    return ok(result);
  }

  const now = Date.now();
  const wanted = options.limit;
  const limit =
    wanted === undefined || !Number.isFinite(wanted)
      ? GRANT_LIST_LIMIT_MAX
      : Math.min(GRANT_LIST_LIMIT_MAX, Math.max(1, Math.floor(wanted)));
  const ordered = [...listed.value].sort(
    (a, b) =>
      grantListRank(a, now) - grantListRank(b, now) ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  const items: GrantWithRecipient[] = [];
  for (const grant of ordered.slice(0, limit)) {
    items.push({ ...grant, recipient: await resolveGrantRecipient(db, grant) });
  }
  return ok({
    items,
    counts: {
      total: listed.value.length,
      active: listed.value.filter((grant) => grant.status === 'ACTIVE').length,
      holdingAccess: listed.value.filter((grant) => grantListRank(grant, now) === 0).length,
      holdingAccessShown: items.filter((grant) => grantListRank(grant, now) === 0).length,
    },
  });
}

async function resolveGrantRecipient(
  db: Db,
  grant: Pick<Grant, 'recipientAccountId' | 'recipientOrganizationId'>,
): Promise<GrantRecipient> {
  if (grant.recipientAccountId) {
    const account = first(
      await db
        .select({ email: schema.accounts.email })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, grant.recipientAccountId))
        .limit(1),
    );
    return { kind: 'account', label: account?.email ?? 'Unknown recipient' };
  }
  if (grant.recipientOrganizationId) {
    const organization = first(
      await db
        .select({ name: schema.organizations.name })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, grant.recipientOrganizationId))
        .limit(1),
    );
    return { kind: 'organization', label: organization?.name ?? 'Unknown organization' };
  }
  return { kind: 'unknown', label: 'Unknown recipient' };
}

// --- Per-case sharing exceptions (ADR 0017) ---------------------------------
//
// When a new case is made, the owner is asked, for each recipient holding
// an all-cases grant (or a pending all-cases invitation), whether that
// recipient may see the new case. No answer means no. A "no" is one row in
// `grant_case_exclusions`; the policy engine and the SQL list paths both read
// it (access/grant-scope.ts). The recipient is never told about an exception
// or about the case it hides: nothing here notifies anyone.

const CASE_SHARING_UNAVAILABLE =
  'Sharing choices for new cases are not available yet. Please try again in a few minutes.';

/** One recipient the owner is asked about when a new case is made. */
export interface CaseSharingQuestion {
  /** A grant the recipient holds, or an invitation they have not accepted yet. */
  readonly kind: 'grant' | 'invitation';
  readonly id: string;
  readonly recipient: GrantRecipient;
  readonly purpose: string;
  /** The grant status, or `PENDING` for an invitation. */
  readonly status: Grant['status'] | 'PENDING';
}

function ownerOnly<A extends PermissionAction>(
  proof: AuthorizedApplicant<A>,
  action: A,
): ServiceError | undefined {
  if (!AuthorizedApplicant.isGenuine(proof, action) || proof.actor.kind !== 'applicant_owner') {
    return serviceError('forbidden', 'Only the owner of this record can choose who sees a case.');
  }
  return undefined;
}

/** The all-cases grants and pending all-cases invitations of one applicant, live right now. */
async function loadCaseSharingQuestions(
  db: Db,
  applicantId: string,
  now: Date,
): Promise<CaseSharingQuestion[]> {
  const grantRows = await db
    .select()
    .from(schema.grants)
    .where(
      and(
        eq(schema.grants.applicantId, applicantId),
        isNull(schema.grants.missionId),
        inArray(schema.grants.status, [...LIVE_GRANT_STATUSES]),
        or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
      ),
    )
    .orderBy(asc(schema.grants.createdAt), asc(schema.grants.id));
  const invitationRows = await db
    .select({
      id: schema.sharingInvitations.id,
      email: schema.sharingInvitations.email,
      purpose: schema.sharingInvitations.purpose,
    })
    .from(schema.sharingInvitations)
    .where(
      and(
        eq(schema.sharingInvitations.applicantId, applicantId),
        isNull(schema.sharingInvitations.missionId),
        eq(schema.sharingInvitations.status, 'PENDING'),
        gt(schema.sharingInvitations.expiresAt, now),
      ),
    )
    .orderBy(asc(schema.sharingInvitations.createdAt), asc(schema.sharingInvitations.id));
  const questions: CaseSharingQuestion[] = [];
  for (const grant of grantRows) {
    questions.push({
      kind: 'grant',
      id: grant.id,
      recipient: await resolveGrantRecipient(db, grant),
      purpose: grant.purpose,
      status: grant.status,
    });
  }
  for (const invitation of invitationRows) {
    questions.push({
      kind: 'invitation',
      id: invitation.id,
      recipient: { kind: 'account', label: invitation.email },
      purpose: invitation.purpose,
      status: 'PENDING',
    });
  }
  return questions;
}

/**
 * Who the owner must be asked about before a new case is made: every
 * all-cases grant that is active, paused or awaiting acceptance and not
 * expired, and every pending all-cases invitation, with a plain label for the
 * recipient. Owner only. Case-scoped grants are never listed: they cannot
 * reach a new case.
 */
export async function listCaseSharingQuestions(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<CaseSharingQuestion[], ServiceError>> {
  const denied = ownerOnly(proof, 'VIEW_METADATA');
  if (denied) return err(denied);
  return ok(await loadCaseSharingQuestions(proof.tx, proof.applicant.id, new Date()));
}

export interface CaseSharingAnswers {
  /** The grants the owner ticked: they keep covering the new case. */
  readonly allowedGrantIds: readonly string[];
  /** The pending invitations the owner ticked: once accepted, they cover the new case. */
  readonly allowedInvitationIds: readonly string[];
}

export interface CaseSharingOutcome {
  readonly excludedGrantIds: readonly string[];
  readonly excludedInvitationIds: readonly string[];
  readonly allowedGrantIds: readonly string[];
  readonly allowedInvitationIds: readonly string[];
}

/**
 * Records the owner's answers for a new case, in the same transaction that
 * creates it (pass a proof issued on that transaction). Every all-cases
 * grant and pending all-cases invitation NOT ticked is excluded from this
 * case; the list is computed here, at apply time, so a recipient added after
 * the question was shown is excluded too (no answer means no). A ticked id
 * that is not one of this person's current all-cases grants or invitations is
 * refused rather than ignored.
 *
 * One-shot: once answers are recorded for a case (any GRANT_CASE_EXCLUDED or
 * GRANT_CASE_ALLOWED event on it), a second call is refused. Later changes go
 * through `removeCaseException` ("Allow This Case") only, so the rows and the
 * audit trail can never disagree and a restore, which replays the trail,
 * ends exactly where the owner left it. Exactly the rows inserted are audited.
 *
 * An organization that owns the case (`missions.owner_organization_id`) runs
 * it for the person: it cannot be excluded from it, and leaving it unticked
 * is refused with a plain message.
 *
 * Refuses with `upstream_error` while migration 0090 has not run and a "no"
 * would have to be written: the caller must then roll back the case it was
 * creating (throw inside its transaction), so a "no" is never lost. When
 * every recipient was ticked there is nothing to write, so it goes ahead.
 * Never notifies anyone. Owner only; the proof must be MANAGE on the new case.
 */
export async function applyCaseSharingAnswers(
  proof: AuthorizedApplicant<'MANAGE'>,
  answers: CaseSharingAnswers,
): Promise<Result<CaseSharingOutcome, ServiceError>> {
  const denied = ownerOnly(proof, 'MANAGE');
  if (denied) return err(denied);
  if (proof.resource.kind !== 'mission') {
    return err(serviceError('invalid', 'Choose the case these answers are for.'));
  }
  const applicantId = proof.applicant.id;
  const mission = proof.resource.mission;
  const missionId = mission.id;
  const ownerAccountId = proof.applicant.ownerAccountId;

  return proof.tx.transaction(async (tx) => {
    // Before reading any grant or invitation: an invitation accepted, or an
    // all-cases grant created, at the same moment waits for these answers.
    await lockCaseSharing(tx, applicantId);
    const alreadyAnswered = first(
      await tx
        .select({ seq: schema.auditEvents.seq })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.missionId, missionId),
            inArray(schema.auditEvents.eventType, ['GRANT_CASE_EXCLUDED', 'GRANT_CASE_ALLOWED']),
          ),
        )
        .limit(1),
    );
    if (alreadyAnswered) {
      return err(
        serviceError(
          'invalid',
          'Sharing for this case was already chosen. To share it with someone now, use Allow This Case on the Sharing page.',
        ),
      );
    }

    const questions = await loadCaseSharingQuestions(tx, applicantId, new Date());
    const grantQuestions = questions.filter((q) => q.kind === 'grant');
    const grantIds = new Set(grantQuestions.map((q) => q.id));
    const invitationIds = new Set(
      questions.filter((q) => q.kind === 'invitation').map((q) => q.id),
    );
    const allowedGrants = new Set(answers.allowedGrantIds);
    const allowedInvitations = new Set(answers.allowedInvitationIds);
    if (
      [...allowedGrants].some((id) => !grantIds.has(id)) ||
      [...allowedInvitations].some((id) => !invitationIds.has(id))
    ) {
      return err(
        serviceError('invalid', 'One of the people you chose no longer has access to all cases.'),
      );
    }
    const outcome: CaseSharingOutcome = {
      excludedGrantIds: [...grantIds].filter((id) => !allowedGrants.has(id)),
      excludedInvitationIds: [...invitationIds].filter((id) => !allowedInvitations.has(id)),
      allowedGrantIds: [...grantIds].filter((id) => allowedGrants.has(id)),
      allowedInvitationIds: [...invitationIds].filter((id) => allowedInvitations.has(id)),
    };
    const owningOrganization = mission.ownerOrganizationId;
    if (owningOrganization && outcome.excludedGrantIds.length > 0) {
      const owningGrant = first(
        await tx
          .select({ id: schema.grants.id })
          .from(schema.grants)
          .where(
            and(
              inArray(schema.grants.id, [...outcome.excludedGrantIds]),
              eq(schema.grants.recipientOrganizationId, owningOrganization),
            ),
          )
          .limit(1),
      );
      const owning = owningGrant && grantQuestions.find((q) => q.id === owningGrant.id);
      if (owning) {
        return err(
          serviceError(
            'invalid',
            `${owning.recipient.label} runs this case for you, so it always sees it. Tick it to continue.`,
          ),
        );
      }
    }
    if (questions.length === 0) return ok(outcome);
    const excluded = [
      ...outcome.excludedGrantIds.map((id) => ({ grantId: id, sharingInvitationId: null })),
      ...outcome.excludedInvitationIds.map((id) => ({ grantId: null, sharingInvitationId: id })),
    ];
    if (excluded.length > 0 && !(await caseExclusionsTablePresent(tx))) {
      return err(serviceError('upstream_error', CASE_SHARING_UNAVAILABLE));
    }

    const audit = async (
      eventType: 'GRANT_CASE_EXCLUDED' | 'GRANT_CASE_ALLOWED',
      parent: { readonly grantId: string | null; readonly sharingInvitationId: string | null },
    ): Promise<void> => {
      const id = parent.grantId ?? parent.sharingInvitationId;
      await appendAuditEvent(tx, {
        eventType,
        actorAccountId: ownerAccountId,
        action: 'SHARE',
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId,
        missionId,
        grantId: parent.grantId,
        resourceType: parent.grantId ? 'grant' : 'sharing_invitation',
        resourceId: id,
      });
    };
    if (excluded.length > 0) {
      const inserted = await tx
        .insert(schema.grantCaseExclusions)
        .values(
          excluded.map((parent) => ({
            ...parent,
            missionId,
            applicantId,
            createdByAccountId: ownerAccountId,
          })),
        )
        .onConflictDoNothing()
        .returning({
          grantId: schema.grantCaseExclusions.grantId,
          sharingInvitationId: schema.grantCaseExclusions.sharingInvitationId,
        });
      // Exactly the rows written, so the trail and the table always agree.
      for (const row of inserted) await audit('GRANT_CASE_EXCLUDED', row);
    }
    for (const id of outcome.allowedGrantIds) {
      await audit('GRANT_CASE_ALLOWED', { grantId: id, sharingInvitationId: null });
    }
    for (const id of outcome.allowedInvitationIds) {
      await audit('GRANT_CASE_ALLOWED', { grantId: null, sharingInvitationId: id });
    }
    return ok(outcome);
  });
}

/**
 * The owner's "Allow This Case": removes one exception, so the all-cases
 * grant covers this case again. A hard delete; the audit trail keeps the
 * history. Refused on a revoked or expired grant (there is nothing left to
 * allow). Asks for a fresh sign-in only when the grant itself needed one to
 * be created (it hands out a `STEP_UP_ACTIONS` action, the `createGrant`
 * rule): the proof must cover SHARE on this person's record. Never notifies
 * the recipient. Owner only; the proof must be MANAGE on the case.
 *
 * Exceptions follow the recipient, so allowing follows the recipient too: the
 * same case's exceptions on every other grant and invitation of that
 * recipient (live or ended) are removed with it, each audited, so no sibling
 * keeps the case hidden and sharing all cases with them again later does not
 * carry the old "no" forward.
 */
export async function removeCaseException(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: { readonly grantId: string; readonly stepUp?: StepUpProof },
): Promise<Result<{ readonly grantId: string; readonly missionId: string }, ServiceError>> {
  const denied = ownerOnly(proof, 'MANAGE');
  if (denied) return err(denied);
  if (proof.resource.kind !== 'mission') {
    return err(serviceError('invalid', 'Choose the case to allow.'));
  }
  const applicantId = proof.applicant.id;
  const missionId = proof.resource.mission.id;
  const ownerAccountId = proof.applicant.ownerAccountId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.grantId)) {
    return err(serviceError('not_found', 'That sharing was not found.'));
  }
  return proof.tx.transaction(async (tx) => {
    await lockCaseSharing(tx, applicantId);
    const grant = await loadGrant(tx, input.grantId);
    if (!grant || grant.applicantId !== applicantId || grant.missionId !== null) {
      return err(serviceError('not_found', 'That sharing was not found.'));
    }
    if (!isLiveGrant(grant, new Date())) {
      return err(serviceError('invalid', 'This sharing has ended, so there is nothing to allow.'));
    }
    if (
      grant.actions.some((action) => STEP_UP_ACTIONS.includes(action)) &&
      !StepUpProof.covers(input.stepUp, {
        accountId: ownerAccountId,
        action: 'SHARE',
        resourceId: applicantId,
      })
    ) {
      return err(serviceError('step_up_required', 'Confirm it is you to allow this case.'));
    }
    if (!(await caseExclusionsTablePresent(tx))) {
      return err(serviceError('not_found', 'This case is already shared.'));
    }
    const exclusions = schema.grantCaseExclusions;
    const removed = await tx
      .delete(exclusions)
      .where(
        and(
          eq(exclusions.grantId, grant.id),
          eq(exclusions.missionId, missionId),
          eq(exclusions.applicantId, applicantId),
        ),
      )
      .returning({ id: exclusions.id });
    if (removed.length === 0) {
      return err(serviceError('not_found', 'This case is already shared.'));
    }
    const audit = async (parent: {
      readonly kind: 'grant' | 'sharing_invitation';
      readonly id: string;
    }) =>
      appendAuditEvent(tx, {
        eventType: 'GRANT_CASE_EXCLUSION_REMOVED',
        actorAccountId: ownerAccountId,
        action: 'SHARE',
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId,
        missionId,
        grantId: parent.kind === 'grant' ? parent.id : null,
        resourceType: parent.kind,
        resourceId: parent.id,
      });
    await audit({ kind: 'grant', id: grant.id });

    // Every other grant and invitation of the same recipient, live or ended:
    // the owner's latest word for this recipient on this case is "allow", so
    // no sibling may keep (or later carry forward) the old "no".
    const sources = await recipientExceptionSources(tx, applicantId, {
      kind: 'grant',
      id: grant.id,
      recipientAccountId: grant.recipientAccountId,
      recipientOrganizationId: grant.recipientOrganizationId,
    });
    const siblingGrantIds = sources.grants.map((g) => g.id);
    const siblingInvitationIds = sources.invitations.map((i) => i.id);
    if (siblingGrantIds.length + siblingInvitationIds.length > 0) {
      const stale = await tx
        .delete(exclusions)
        .where(
          and(
            eq(exclusions.applicantId, applicantId),
            eq(exclusions.missionId, missionId),
            or(
              siblingGrantIds.length > 0 ? inArray(exclusions.grantId, siblingGrantIds) : undefined,
              siblingInvitationIds.length > 0
                ? inArray(exclusions.sharingInvitationId, siblingInvitationIds)
                : undefined,
            ),
          ),
        )
        .returning({ grantId: exclusions.grantId, invitationId: exclusions.sharingInvitationId });
      for (const row of stale) {
        await audit(
          row.grantId
            ? { kind: 'grant', id: row.grantId }
            : { kind: 'sharing_invitation', id: row.invitationId ?? '' },
        );
      }
    }
    return ok({ grantId: grant.id, missionId });
  });
}

// --- Recipient-facing permission-filtered workspace (Release G) ------------
//
// Every prior "sharing" surface only managed the grant lifecycle
// (create/accept/revoke) or gave the OWNER transparency into who has access.
// Nothing previously re-evaluated `authorize()` from the RECIPIENT's side to
// decide what they may actually see — and critically, a direct
// account-to-account grant (the primary "share by email" flow in
// grant-form.tsx) had no `Actor` shape it could even be checked against
// (see `individual_recipient` in packages/policy). This is that missing
// permission-filtered read path.

/** The three types that had a sharing category before the catalogue. They are looked up first and
 * their category never changes, so a grant made earlier behaves exactly as it did.
 */
const DOC_TYPE_TO_PACK: Readonly<Record<string, string>> = {
  PASSPORT: 'universal',
  BANK_STATEMENT: 'universal',
  EMPLOYMENT_CERTIFICATE: 'professional',
};

/**
 * The sharing category of a document type, in the same vocabulary profile fields use, so one grant's
 * `categories` allow-list scopes both consistently. The three original types keep their category; every
 * other type takes the category the catalogue files it under (by its key or any alias). A type the
 * catalogue does not know, or files under no category, gets none, and a grant with a `categories`
 * restriction will not surface it (fail closed).
 *
 * A category grant still covers only the documents it was frozen to when it was created
 * (`documentScopeSnapshot`), so mapping more types never widens a grant that already exists: a new
 * type's documents join a grant only when the owner creates a new grant or confirms an expansion.
 */
function categoryOfDocType(docType: string | null | undefined): string | undefined {
  if (!docType) return undefined;
  return DOC_TYPE_TO_PACK[docType] ?? resolveDocumentType(docType)?.pack ?? undefined;
}

/** Exported wrapper around `DOC_TYPE_TO_PACK` for callers outside this file (e.g. `wallet.ts`'s own category-scoped access computation) that need the identical mapping, never a second copy of it. */
export function documentCategory(docType: string | null): string | undefined {
  return categoryOfDocType(docType);
}

/**
 * Document ids belonging to `applicantId` whose classified category is in
 * `categories`, evaluated against the CURRENT document set at call time.
 * Used both to snapshot a fresh category grant's scope at creation and to
 * find candidates for an explicit `expandGrantScope` later (PRD SHR-01,
 * AD-11), never to decide live visibility itself, which is what the
 * snapshot exists to avoid.
 */
async function documentIdsMatchingCategories(
  db: Db,
  applicantId: string,
  categories: readonly string[],
): Promise<string[]> {
  const lifecycle = await lifecycleTablesPresent(db);
  const rows = await db
    .select({ id: schema.documents.id, docType: schema.documents.docType })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.applicantId, applicantId),
        // Automatic category matching: everydayDocumentCondition (archived is never newly shared).
        lifecycle ? everydayDocumentCondition() : undefined,
      ),
    );
  return rows
    .filter((d) => {
      const category = categoryOfDocType(d.docType);
      return category !== undefined && categories.includes(category);
    })
    .map((d) => d.id);
}

export interface RecipientFieldView {
  readonly fieldKey: string;
  readonly value: string | null;
  readonly status: string | null;
}

export interface RecipientDocumentView {
  readonly id: string;
  readonly displayName: string;
  readonly docType: string | null;
}

export interface RecipientWorkspaceView {
  readonly applicantId: string;
  readonly applicantDisplayName: string;
  readonly grant: Grant;
  readonly fields: readonly RecipientFieldView[];
  readonly documents: readonly RecipientDocumentView[];
  /**
   * True when this grant is mission-scoped. No fact or document in today's
   * data model carries a `missionId`, so a mission-scoped grant's resources
   * never match (`scope_mismatch`, Build Spec law 5) and `fields`/`documents`
   * are always empty in that case — fail closed, not silently pretended to
   * work. The UI surfaces this flag to explain why, honestly, rather than
   * showing an unexplained blank page.
   */
  readonly missionScopeUnavailable: boolean;
}

/**
 * The permission-filtered view of an applicant's shared data for ONE
 * specific, active, accepted grant. Every field and document is re-checked
 * live through `authorize()` — nothing here is a cached snapshot from
 * accept-time. Document PREVIEW/DOWNLOAD is intentionally NOT wired to serve
 * actual bytes: `/api/blob/[key]` fails closed on any non-`original` variant
 * until real redacted renditions exist (Milestone 2), so a recipient would
 * hit that 501 regardless of what this function returns — the document list
 * is scoped visibility only, not a working preview, and the UI must say so.
 */
export async function getRecipientWorkspace(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<RecipientWorkspaceView, ServiceError>> {
  const grant = await loadGrant(db, input.grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (grant.status !== 'ACTIVE' || !grant.acceptedAt) {
    return err(serviceError('forbidden', 'this grant is not active'));
  }

  let actor: PolicyActor;
  if (grant.recipientAccountId === input.actorAccountId) {
    actor = { kind: 'individual_recipient', accountId: input.actorAccountId as AccountId };
  } else if (grant.recipientOrganizationId) {
    const membership = first(
      await db
        .select({
          role: schema.memberships.role,
          active: schema.memberships.active,
          organizationStatus: schema.organizations.status,
        })
        .from(schema.memberships)
        .innerJoin(
          schema.organizations,
          eq(schema.organizations.id, schema.memberships.organizationId),
        )
        .where(
          and(
            eq(schema.memberships.accountId, input.actorAccountId),
            eq(schema.memberships.organizationId, grant.recipientOrganizationId),
          ),
        )
        .limit(1),
    );
    if (!membership?.active) {
      return err(serviceError('forbidden', 'not authorized to view this shared workspace'));
    }
    actor = {
      kind: 'organization_member',
      accountId: input.actorAccountId as AccountId,
      membership: {
        organizationId: grant.recipientOrganizationId as AgencyId,
        role: membership.role,
        active: membership.active,
        // SHR-02: a suspended/closed organization has no standing, even
        // with a still-active membership row.
        organizationActive: membership.organizationStatus === 'ACTIVE',
      },
    };
  } else {
    return err(serviceError('forbidden', 'not authorized to view this shared workspace'));
  }

  const applicant = await getApplicant(db, grant.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));

  const grants = await loadGrantsForPolicy(db, grant.applicantId);
  const now = new Date();
  const authContext = { now, purpose: grant.purpose, stepUpSatisfied: false, grants };

  const fieldRows = await db
    .select({
      fieldKey: schema.fieldDefinitions.key,
      packId: schema.fieldDefinitions.packId,
      value: schema.factVersions.value,
      status: schema.factVersions.status,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.facts.fieldDefinitionId, schema.fieldDefinitions.id),
    )
    .leftJoin(schema.factVersions, eq(schema.facts.currentVersionId, schema.factVersions.id))
    .where(eq(schema.facts.applicantId, grant.applicantId));

  const fields: RecipientFieldView[] = [];
  for (const row of fieldRows) {
    if (row.value === null) continue;
    const decision = authorize({
      actor,
      action: 'VIEW_METADATA',
      resource: {
        applicantId: grant.applicantId as ApplicantId,
        ...(row.packId ? { category: row.packId } : {}),
      },
      context: authContext,
    });
    if (decision.allowed) {
      fields.push({ fieldKey: row.fieldKey, value: row.value, status: row.status });
    }
  }

  const lifecycle = await lifecycleTablesPresent(db);
  const documentRows = await db
    .select({
      id: schema.documents.id,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
      docType: schema.documents.docType,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.applicantId, grant.applicantId),
        // A recipient's view of a shared record: presentDocumentCondition (archive never revokes sharing, D6).
        lifecycle ? presentDocumentCondition() : undefined,
      ),
    );

  const documents: RecipientDocumentView[] = [];
  for (const doc of documentRows) {
    const category = categoryOfDocType(doc.docType);
    const decision = authorize({
      actor,
      action: 'PREVIEW',
      resource: {
        applicantId: grant.applicantId as ApplicantId,
        documentId: doc.id as DocumentId,
        ...(category ? { category } : {}),
      },
      context: authContext,
    });
    if (decision.allowed) {
      documents.push({
        id: doc.id,
        displayName: doc.approvedName ?? doc.originalName,
        docType: doc.docType,
      });
    }
  }

  return ok({
    applicantId: grant.applicantId,
    applicantDisplayName: applicant.displayName,
    grant,
    fields,
    documents,
    missionScopeUnavailable: grant.missionId !== null,
  });
}

// --- Explicit category scope expansion (PRD SHR-01, AD-11) ------------------
//
// A `categories`-scoped grant is frozen to `documentScopeSnapshot` at
// creation (see `createGrant` above). These two functions are the ONLY way
// that snapshot ever grows: `previewScopeExpansion` computes what a
// "displayed confirmation" would show; `expandGrantScope` is the owner's
// explicit act of actually confirming it. Neither ever widens `categories`
// itself, and neither is reachable by the recipient.

export interface ScopeExpansionCandidate {
  readonly id: string;
  readonly displayName: string;
  readonly docType: string | null;
}

/**
 * Documents that now match a category grant's own `categories` but are not
 * yet in its `documentScopeSnapshot`: exactly the list a confirmation
 * dialog needs to show before the owner decides whether to include them.
 * Returns an empty list, never an error, for a grant with no categories (an
 * unrestricted or `documentIds`-only grant has nothing to expand) or once
 * every matching document is already included.
 */
export async function previewScopeExpansion(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<readonly ScopeExpansionCandidate[], ServiceError>> {
  const grant = await loadGrant(db, input.grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (!(await ownsApplicant(db, input.actorAccountId, grant.applicantId))) {
    return err(serviceError('forbidden', 'only the applicant owner can view this grant'));
  }
  if (!grant.categories || grant.categories.length === 0) return ok([]);

  const alreadyIncluded = new Set(grant.documentScopeSnapshot ?? []);
  const matchingIds = new Set(
    await documentIdsMatchingCategories(db, grant.applicantId, grant.categories),
  );
  const candidateIds = [...matchingIds].filter((id) => !alreadyIncluded.has(id));
  if (candidateIds.length === 0) return ok([]);

  const lifecycle = await lifecycleTablesPresent(db);
  const rows = await db
    .select({
      id: schema.documents.id,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
      docType: schema.documents.docType,
    })
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.id, candidateIds),
        // Offered for a wider share: everydayDocumentCondition.
        lifecycle ? everydayDocumentCondition() : undefined,
      ),
    );
  return ok(
    rows.map((d) => ({
      id: d.id,
      displayName: d.approvedName ?? d.originalName,
      docType: d.docType,
    })),
  );
}

/**
 * The owner's explicit act of widening a category grant's scope to include
 * specific, named documents that now match its categories (PRD SHR-01:
 * "expanding scope requires a displayed confirmation": `documentIds` here
 * is exactly what that confirmation showed, never re-derived silently).
 * Each id is re-verified against the grant's own categories at this moment,
 * not trusted from an earlier `previewScopeExpansion` call that may be
 * stale; a caller naming a document that does not actually match is refused
 * rather than silently dropped, since that would mean the confirmation
 * shown did not match what actually happened.
 */
export async function expandGrantScope(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly grantId: string;
    readonly documentIds: readonly string[];
  },
): Promise<Result<Grant, ServiceError>> {
  const grant = await loadGrant(db, input.grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (!(await ownsApplicant(db, input.actorAccountId, grant.applicantId))) {
    return err(serviceError('forbidden', 'only the applicant owner can change this grant'));
  }
  if (!grant.categories || grant.categories.length === 0) {
    return err(serviceError('invalid', 'this grant has no category scope to expand'));
  }
  const requestedIds = [...new Set(input.documentIds)];
  if (requestedIds.length === 0) {
    return err(serviceError('invalid', 'name at least one document to include'));
  }

  const matchingIds = new Set(
    await documentIdsMatchingCategories(db, grant.applicantId, grant.categories),
  );
  const invalidId = requestedIds.find((id) => !matchingIds.has(id));
  if (invalidId) {
    return err(
      serviceError(
        'invalid',
        `document ${invalidId} does not belong to this applicant or does not match this grant's categories`,
      ),
    );
  }

  const alreadyIncluded = new Set(grant.documentScopeSnapshot ?? []);
  const newlyAdded = requestedIds.filter((id) => !alreadyIncluded.has(id));
  const nextSnapshot = [...alreadyIncluded, ...newlyAdded];

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.grants)
          .set({ documentScopeSnapshot: nextSnapshot, updatedAt: new Date() })
          .where(eq(schema.grants.id, input.grantId))
          .returning(),
      ),
      'grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'GRANT_SCOPE_EXPANDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: grant.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
      metadata: { addedDocumentIds: newlyAdded, addedCount: newlyAdded.length },
    });
    return ok(updated);
  });
}
