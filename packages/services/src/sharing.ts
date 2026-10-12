import {
  type AccountId,
  type AgencyId,
  type ApplicantId,
  type DocumentId,
  type MissionId,
  PERMISSION_ACTIONS,
  PROFILE_PACKS,
  type PermissionAction,
} from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import {
  type Actor as PolicyActor,
  type Grant as PolicyGrant,
  STEP_UP_ACTIONS,
  authorize,
} from '@visastack/policy';
import { and, eq, inArray } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
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

/** Map the grant rows for an applicant into the policy engine's Grant shape. */
export async function loadGrantsForPolicy(db: Db, applicantId: string): Promise<PolicyGrant[]> {
  const rows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  return rows.map((row) => ({
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
    ...(row.categories ? { categories: row.categories } : {}),
    ...(row.documentIds ? { documentIds: row.documentIds as DocumentId[] } : {}),
    ...(row.documentScopeSnapshot
      ? { categoryScopeDocumentIds: row.documentScopeSnapshot as DocumentId[] }
      : {}),
    ...(row.acceptedAt ? { acceptedAt: row.acceptedAt.toISOString() } : {}),
    ...(row.expiryAt ? { expiryAt: row.expiryAt.toISOString() } : {}),
  }));
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
  if (input.actions.some((action) => STEP_UP_ACTIONS.includes(action)) && !input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'granting this level of access requires reauthentication'),
    );
  }
  if (input.purpose.trim().length === 0) {
    return err(serviceError('invalid', 'a purpose is required'));
  }
  if (input.categories) {
    const invalidCategory = input.categories.find(
      (category) => !(PROFILE_PACKS as readonly string[]).includes(category),
    );
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
    const docs = await db
      .select({ id: schema.documents.id, applicantId: schema.documents.applicantId })
      .from(schema.documents)
      .where(inArray(schema.documents.id, uniqueIds));
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
  const rows = await db
    .select({ grant: schema.grants, applicantName: schema.applicants.displayName })
    .from(schema.grants)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.grants.applicantId))
    .where(eq(schema.grants.recipientAccountId, accountId));
  return [...rows]
    .sort((a, b) => b.grant.createdAt.getTime() - a.grant.createdAt.getTime())
    .map((r) => ({ grant: r.grant, applicantName: r.applicantName }));
}

/** Access transparency: every grant on an applicant (owner only). */
export async function listAccessForApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<Grant[], ServiceError>> {
  if (!(await ownsApplicant(db, actorAccountId, applicantId))) {
    return err(serviceError('forbidden', 'not authorized to view access for this applicant'));
  }
  const rows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  return ok(rows);
}

/** A grant's recipient, resolved to something a human recognizes rather than a raw id. */
export interface GrantRecipient {
  readonly kind: 'account' | 'organization' | 'unknown';
  readonly label: string;
}

export interface GrantWithRecipient extends Grant {
  readonly recipient: GrantRecipient;
}

/** Same as `listAccessForApplicant`, but resolves WHO each grant was given to. */
export async function listAccessForApplicantDetailed(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<GrantWithRecipient[], ServiceError>> {
  const listed = await listAccessForApplicant(db, actorAccountId, applicantId);
  if (!listed.ok) return listed;

  const result: GrantWithRecipient[] = [];
  for (const grant of listed.value) {
    let recipient: GrantRecipient = { kind: 'unknown', label: 'Unknown recipient' };
    if (grant.recipientAccountId) {
      const account = first(
        await db
          .select({ email: schema.accounts.email })
          .from(schema.accounts)
          .where(eq(schema.accounts.id, grant.recipientAccountId))
          .limit(1),
      );
      recipient = { kind: 'account', label: account?.email ?? 'Unknown recipient' };
    } else if (grant.recipientOrganizationId) {
      const organization = first(
        await db
          .select({ name: schema.organizations.name })
          .from(schema.organizations)
          .where(eq(schema.organizations.id, grant.recipientOrganizationId))
          .limit(1),
      );
      recipient = { kind: 'organization', label: organization?.name ?? 'Unknown organization' };
    }
    result.push({ ...grant, recipient });
  }
  return ok(result);
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

/** Maps a document's deterministic classification to the same pack vocabulary
 * profile fields use, so one grant's `categories` allow-list can scope both
 * consistently. Unclassified/unrecognized types get no category — a grant
 * with a `categories` restriction will not surface them (fail closed).
 */
const DOC_TYPE_TO_PACK: Readonly<Record<string, string>> = {
  PASSPORT: 'universal',
  BANK_STATEMENT: 'universal',
  EMPLOYMENT_CERTIFICATE: 'professional',
};

/** Exported wrapper around `DOC_TYPE_TO_PACK` for callers outside this file (e.g. `wallet.ts`'s own category-scoped access computation) that need the identical mapping, never a second copy of it. */
export function documentCategory(docType: string | null): string | undefined {
  return docType ? DOC_TYPE_TO_PACK[docType] : undefined;
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
  const rows = await db
    .select({ id: schema.documents.id, docType: schema.documents.docType })
    .from(schema.documents)
    .where(eq(schema.documents.applicantId, applicantId));
  return rows
    .filter((d) => {
      const category = d.docType ? DOC_TYPE_TO_PACK[d.docType] : undefined;
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

  const documentRows = await db
    .select({
      id: schema.documents.id,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
      docType: schema.documents.docType,
    })
    .from(schema.documents)
    .where(eq(schema.documents.applicantId, grant.applicantId));

  const documents: RecipientDocumentView[] = [];
  for (const doc of documentRows) {
    const category = doc.docType ? DOC_TYPE_TO_PACK[doc.docType] : undefined;
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

  const rows = await db
    .select({
      id: schema.documents.id,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
      docType: schema.documents.docType,
    })
    .from(schema.documents)
    .where(inArray(schema.documents.id, candidateIds));
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
