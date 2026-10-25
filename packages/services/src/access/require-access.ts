import type {
  AccountId,
  AgencyId,
  ApplicantId,
  DocumentId,
  MissionId,
  PermissionAction,
  Result,
} from '@visastack/core';
import { err, ok } from '@visastack/core';
import {
  type Actor,
  type Decision,
  type DenyReason,
  type Grant as PolicyGrant,
  type Resource as PolicyResource,
  authorize,
} from '@visastack/policy';
import { eq } from 'drizzle-orm';
import { type Applicant, getApplicant } from '../applicants';
import { isInFlightContributorSubmission } from '../contributor-requests';
import { type Db, first, schema } from '../db';
import { type ServiceError, serviceError } from '../errors';
import { listMembershipsForAccount } from '../organizations';
import { documentCategory, loadGrantsForPolicy } from '../sharing';
import { loadSupportGrantsForPolicy } from '../support-access';
import { AUTHORIZED_APPLICANT } from './brand';
import type { AccountPrincipal, Principal } from './principal';

/**
 * The central authorization gate for applicant-owned records.
 *
 * `requireAccess` resolves who the caller is relative to one applicant
 * record from live database state (never from anything the caller claims),
 * loads the grants the same way document access does, and asks the existing
 * default-deny policy engine (`@visastack/policy`'s `authorize`). On success
 * it returns an `AuthorizedApplicant`, a branded value nothing outside
 * `access/` can build, which service functions can demand as a parameter so
 * the type system proves a check happened. Nothing here writes data.
 */

/**
 * Evaluate each grant against its own declared purpose instead of one
 * request purpose: the "does any current grant permit this" question that
 * `orgGrantPermits` (agency.ts) answers. A unique symbol rather than a
 * magic string, so no caller-supplied purpose text can ever select it.
 */
export const EACH_GRANT: unique symbol = Symbol('visastack.access.eachGrant');

export type AccessPurpose = string | typeof EACH_GRANT;

/** Exactly one applicant-owned record to check access against. */
export type ApplicantResourceRef =
  | { readonly applicantId: string; readonly missionId?: never; readonly documentId?: never }
  | { readonly missionId: string; readonly applicantId?: never; readonly documentId?: never }
  | { readonly documentId: string; readonly applicantId?: never; readonly missionId?: never };

/**
 * The only actions an in-flight contributor (CAS-08) may be authorized for:
 * handing over the one piece of evidence they were asked for. A contributor
 * never gets a wallet, profile or case view.
 */
export const CONTRIBUTOR_ACTIONS: readonly PermissionAction[] = ['PROPOSE_EDIT'];

export type AccessActor =
  | Actor
  | {
      readonly kind: 'contributor';
      readonly accountId: AccountId;
      readonly contributorRequestId: string;
    };

type MissionRow = typeof schema.missions.$inferSelect;
type DocumentRow = typeof schema.documents.$inferSelect;

export type AuthorizedResource =
  | { readonly kind: 'applicant'; readonly applicantId: string }
  | { readonly kind: 'mission'; readonly applicantId: string; readonly mission: MissionRow }
  | { readonly kind: 'document'; readonly applicantId: string; readonly document: DocumentRow };

/**
 * Proof that `action` on `resource` was authorized for `actor` inside
 * `tx`. Only `requireAccess` can produce one; the brand property is keyed by
 * a symbol that is not exported outside `access/`.
 */
export interface AuthorizedApplicant<A extends PermissionAction = PermissionAction> {
  readonly [AUTHORIZED_APPLICANT]: A;
  readonly tx: Db;
  readonly applicant: Applicant;
  readonly actor: AccessActor;
  readonly resource: AuthorizedResource;
  readonly action: A;
  readonly purpose: AccessPurpose;
}

export interface RequireAccessOptions {
  readonly purpose: AccessPurpose;
  /**
   * Whether a genuine, recent reauthentication backs this request. Never
   * defaults to satisfied. A later step replaces this boolean with a typed
   * step-up proof.
   */
  readonly stepUpSatisfied?: boolean;
  /** Evaluation time (tests). Defaults to now. */
  readonly now?: Date;
  /** CAS-08: the claimed contributor request this call acts under, verified live, never trusted. */
  readonly contributorRequestId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

interface LoadedResource {
  readonly applicant: Applicant;
  readonly resource: AuthorizedResource;
  readonly policyResource: PolicyResource;
}

type RefKey = 'applicantId' | 'missionId' | 'documentId';

function refTarget(ref: ApplicantResourceRef): { key: RefKey; id: unknown } | undefined {
  const present = (['applicantId', 'missionId', 'documentId'] as const).filter(
    (key) => (ref as Partial<Record<RefKey, unknown>>)[key] !== undefined,
  );
  const key = present[0];
  if (present.length !== 1 || key === undefined) return undefined;
  return { key, id: (ref as Partial<Record<RefKey, unknown>>)[key] };
}

async function loadResource(tx: Db, key: RefKey, id: string): Promise<LoadedResource | undefined> {
  switch (key) {
    case 'applicantId': {
      const applicant = await getApplicant(tx, id);
      if (!applicant) return undefined;
      return {
        applicant,
        resource: { kind: 'applicant', applicantId: applicant.id },
        policyResource: { applicantId: applicant.id as ApplicantId },
      };
    }
    case 'missionId': {
      const mission = first(
        await tx.select().from(schema.missions).where(eq(schema.missions.id, id)).limit(1),
      );
      if (!mission) return undefined;
      const applicant = await getApplicant(tx, mission.applicantId);
      if (!applicant) return undefined;
      return {
        applicant,
        resource: { kind: 'mission', applicantId: applicant.id, mission },
        policyResource: {
          applicantId: applicant.id as ApplicantId,
          missionId: mission.id as MissionId,
        },
      };
    }
    case 'documentId': {
      const document = first(
        await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1),
      );
      if (!document) return undefined;
      const applicant = await getApplicant(tx, document.applicantId);
      if (!applicant) return undefined;
      // Same document-to-category mapping the shared-workspace view and the
      // wallet use, so a category-scoped grant covers the same documents here.
      const category = documentCategory(document.docType);
      return {
        applicant,
        resource: { kind: 'document', applicantId: applicant.id, document },
        policyResource: {
          applicantId: applicant.id as ApplicantId,
          documentId: document.id as DocumentId,
          ...(category !== undefined ? { category } : {}),
        },
      };
    }
  }
}

function decide(
  actor: Actor,
  action: PermissionAction,
  resource: PolicyResource,
  grants: readonly PolicyGrant[],
  purpose: AccessPurpose,
  now: Date,
  stepUpSatisfied: boolean,
): Decision {
  if (typeof purpose === 'string') {
    return authorize({
      actor,
      action,
      resource,
      context: { now, purpose, stepUpSatisfied, grants },
    });
  }
  // EACH_GRANT: every grant is judged against its own purpose, one at a
  // time, exactly like orgGrantPermits. The base checks (membership,
  // organization status, owner, step-up) still run inside authorize().
  if (grants.length === 0) {
    return authorize({
      actor,
      action,
      resource,
      context: { now, purpose: '', stepUpSatisfied, grants: [] },
    });
  }
  let reason: DenyReason | undefined;
  for (const grant of grants) {
    const decision = authorize({
      actor,
      action,
      resource,
      context: { now, purpose: grant.purpose, stepUpSatisfied, grants: [grant] },
    });
    if (decision.allowed) return decision;
    reason = pickReason(reason, decision.reason);
  }
  return { allowed: false, reason: reason ?? 'default_deny' };
}

/**
 * Keeps the most useful denial reason across several evaluations:
 * `step_up_required` means the caller is otherwise authorized, so it wins;
 * after that the first specific reason beats the generic `default_deny`.
 */
function pickReason(current: DenyReason | undefined, next: DenyReason): DenyReason {
  if (current === undefined) return next;
  if (next === 'step_up_required') return next;
  if (current === 'step_up_required') return current;
  if (current === 'default_deny' && next !== 'default_deny') return next;
  return current;
}

function denied(reason: DenyReason): ServiceError {
  if (reason === 'step_up_required') {
    return serviceError('step_up_required', 'this action requires reauthentication');
  }
  return serviceError('forbidden', `access denied (${reason})`);
}

function authorized<A extends PermissionAction>(
  tx: Db,
  loaded: LoadedResource,
  actor: AccessActor,
  action: A,
  purpose: AccessPurpose,
): AuthorizedApplicant<A> {
  return Object.freeze({
    [AUTHORIZED_APPLICANT]: action,
    tx,
    applicant: loaded.applicant,
    actor,
    resource: loaded.resource,
    action,
    purpose,
  });
}

async function contributorPermits(
  tx: Db,
  principal: AccountPrincipal,
  action: PermissionAction,
  loaded: LoadedResource,
  contributorRequestId: string,
): Promise<boolean> {
  if (!CONTRIBUTOR_ACTIONS.includes(action) || !isUuid(contributorRequestId)) return false;
  // Same check documents.ts uses for a contributor registering evidence.
  const inFlight = await isInFlightContributorSubmission(tx, {
    contributorRequestId,
    actorAccountId: principal.accountId,
    applicantId: loaded.applicant.id,
  });
  if (!inFlight) return false;
  const { resource } = loaded;
  if (resource.kind === 'mission') {
    const request = first(
      await tx
        .select({ missionId: schema.contributorRequests.missionId })
        .from(schema.contributorRequests)
        .where(eq(schema.contributorRequests.id, contributorRequestId))
        .limit(1),
    );
    return request?.missionId === resource.mission.id;
  }
  if (resource.kind === 'document') {
    // A contributor may only touch a document it uploaded itself.
    return resource.document.uploaderAccountId === principal.accountId;
  }
  return true;
}

/**
 * Authorize `principal` to perform `action` on one applicant-owned record.
 *
 * Resolution order, all from live state: the applicant's owner; an
 * in-flight CAS-08 contributor (only with `contributorRequestId`, only for
 * `CONTRIBUTOR_ACTIONS`); each of the account's organization memberships
 * (the policy engine itself denies an inactive membership or a suspended or
 * closed organization, SHR-02); then a direct individual recipient. With
 * `asSupport` only the support path is tried, which needs an approved
 * just-in-time support grant. System and staff principals are refused here:
 * they act through `SystemScope` and `StaffScope`, never through applicant
 * grants.
 *
 * Unknown or malformed ids return `not_found`; a refusal returns `forbidden`,
 * or `step_up_required` when the caller is otherwise allowed but has not
 * reauthenticated.
 */
export async function requireAccess<A extends PermissionAction>(
  tx: Db,
  principal: Principal,
  action: A,
  ref: ApplicantResourceRef,
  opts: RequireAccessOptions,
): Promise<Result<AuthorizedApplicant<A>, ServiceError>> {
  const target = refTarget(ref);
  if (!target) {
    return err(serviceError('invalid', 'name exactly one applicant, case or document'));
  }
  if (principal.kind !== 'account') {
    return err(denied('default_deny'));
  }
  if (!isUuid(principal.accountId)) return err(denied('default_deny'));
  if (!isUuid(target.id)) return err(serviceError('not_found', 'record not found'));

  const loaded = await loadResource(tx, target.key, target.id);
  if (!loaded) return err(serviceError('not_found', 'record not found'));

  const { applicant, policyResource } = loaded;
  const now = opts.now ?? new Date();
  const stepUpSatisfied = opts.stepUpSatisfied ?? false;
  const accountId = principal.accountId as AccountId;

  if (principal.asSupport === true) {
    const actor: Actor = { kind: 'support_admin', accountId };
    const grants = [
      ...(await loadGrantsForPolicy(tx, applicant.id)),
      ...(await loadSupportGrantsForPolicy(tx, applicant.id)),
    ];
    const decision = decide(
      actor,
      action,
      policyResource,
      grants,
      opts.purpose,
      now,
      stepUpSatisfied,
    );
    if (!decision.allowed) return err(denied(decision.reason));
    return ok(authorized(tx, loaded, actor, action, opts.purpose));
  }

  if (applicant.ownerAccountId === principal.accountId) {
    const actor: Actor = { kind: 'applicant_owner', applicantId: applicant.id as ApplicantId };
    const decision = decide(actor, action, policyResource, [], opts.purpose, now, stepUpSatisfied);
    if (!decision.allowed) return err(denied(decision.reason));
    return ok(authorized(tx, loaded, actor, action, opts.purpose));
  }

  if (
    opts.contributorRequestId !== undefined &&
    (await contributorPermits(tx, principal, action, loaded, opts.contributorRequestId))
  ) {
    const actor: AccessActor = {
      kind: 'contributor',
      accountId,
      contributorRequestId: opts.contributorRequestId,
    };
    return ok(authorized(tx, loaded, actor, action, opts.purpose));
  }

  const grants = await loadGrantsForPolicy(tx, applicant.id);
  const memberships = await listMembershipsForAccount(tx, principal.accountId);
  const candidates: Actor[] = [
    ...memberships.map(
      (membership): Actor => ({
        kind: 'organization_member',
        accountId,
        membership: {
          organizationId: membership.organization.id as AgencyId,
          role: membership.role,
          active: membership.active,
          organizationActive: membership.organization.status === 'ACTIVE',
        },
      }),
    ),
    { kind: 'individual_recipient', accountId },
  ];

  let reason: DenyReason | undefined;
  for (const actor of candidates) {
    const decision = decide(
      actor,
      action,
      policyResource,
      grants,
      opts.purpose,
      now,
      stepUpSatisfied,
    );
    if (decision.allowed) return ok(authorized(tx, loaded, actor, action, opts.purpose));
    reason = pickReason(reason, decision.reason);
  }
  return err(denied(reason ?? 'default_deny'));
}
