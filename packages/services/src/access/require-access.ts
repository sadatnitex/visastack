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
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import {
  type Actor,
  type Decision,
  type DenyReason,
  type Grant as PolicyGrant,
  type Resource as PolicyResource,
  authorize,
} from '@visastack/policy';
import { and, eq, ne } from 'drizzle-orm';
import { type Applicant, getApplicant } from '../applicants';
import { type ContributorRequest, isInFlightContributorRow } from '../contributor-requests';
import { type Db, first, schema } from '../db';
import { type ServiceError, serviceError } from '../errors';
import { listMembershipsForAccount } from '../organizations';
import { documentCategory, loadGrantsForPolicy } from '../sharing';
import { loadSupportGrantsForPolicy } from '../support-access';
import type { AccountPrincipal, Principal } from './principal';
import { StepUpProof } from './step-up-proof';

/**
 * The central authorization gate for applicant-owned records.
 *
 * `requireAccess` resolves who the caller is relative to one applicant
 * record from live database state (never from anything the caller claims)
 * and asks the existing default-deny policy engine (`@visastack/policy`'s
 * `authorize`). On success it returns an `AuthorizedApplicant`: a class
 * instance with a private constructor and a `#private` brand, so nothing
 * outside this module can build one, and a spread copy (`{ ...proof }`) is
 * not one, at compile time or at run time. Service functions can demand it
 * as a parameter so the type system proves a check happened. Nothing here
 * writes data.
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
 * Which relationship a non-owner acts through. Omitted, every relationship
 * is tried; if more than one would allow the request, `requireAccess`
 * refuses with `invalid` rather than guess, because the relationship decides
 * whose access is used and recorded.
 */
export type ActingFor = { readonly organizationId: string } | 'individual';

/**
 * The only actions an in-flight contributor (CAS-08) may be authorized for:
 * handing over the one piece of evidence they were asked for, on that one
 * case. A contributor never gets a wallet, profile or case view.
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

interface ProofFields<A extends PermissionAction> {
  readonly tx: Db;
  readonly applicant: Applicant;
  readonly actor: AccessActor;
  readonly resource: AuthorizedResource;
  readonly action: A;
  readonly purpose: AccessPurpose;
}

// Module-private minting: the constructor refuses to run unless this flag is
// set, and only the function assigned in the static block (never exported)
// sets it.
let minting = false;
let mint: <A extends PermissionAction>(fields: ProofFields<A>) => AuthorizedApplicant<A>;

/**
 * Proof that `action` on `resource` was authorized for `actor` inside `tx`.
 * Only `requireAccess` can produce one. The action is part of the type, so a
 * proof for one action is never accepted where another is required.
 */
export class AuthorizedApplicant<A extends PermissionAction> {
  readonly #action: A;
  readonly tx: Db;
  readonly applicant: Applicant;
  readonly actor: AccessActor;
  readonly resource: AuthorizedResource;
  readonly action: A;
  readonly purpose: AccessPurpose;

  private constructor(fields: ProofFields<A>) {
    if (!minting) throw new Error('an AuthorizedApplicant can only be issued by requireAccess()');
    this.#action = fields.action;
    this.tx = fields.tx;
    this.applicant = fields.applicant;
    this.actor = fields.actor;
    this.resource = fields.resource;
    this.action = fields.action;
    this.purpose = fields.purpose;
    Object.freeze(this);
  }

  /** Run-time check that `value` is a genuine proof for `action`, not a copy. */
  static isGenuine<B extends PermissionAction>(
    value: unknown,
    action: B,
  ): value is AuthorizedApplicant<B> {
    return (
      typeof value === 'object' &&
      value !== null &&
      #action in value &&
      (value as AuthorizedApplicant<PermissionAction>).#action === action
    );
  }

  static {
    mint = <B extends PermissionAction>(fields: ProofFields<B>): AuthorizedApplicant<B> => {
      minting = true;
      try {
        return new AuthorizedApplicant(fields);
      } finally {
        minting = false;
      }
    };
  }
}

export interface RequireAccessOptions {
  readonly purpose: AccessPurpose;
  /**
   * A recent identity confirmation for this exact account, action and record
   * (`verifyStepUp`). Anything else, including a copy, counts as none. There
   * is no boolean: a caller cannot simply claim a step-up happened.
   */
  readonly stepUp?: StepUpProof;
  /** CAS-08: the claimed contributor request this call acts under, verified live, never trusted. */
  readonly contributorRequestId?: string;
  /** Which non-owner relationship to act through; see `ActingFor`. */
  readonly actingFor?: ActingFor;
}

/**
 * Document types whose preview or download needs a recent identity
 * confirmation: identity, tax and bank documents (SEC-03 names
 * passport, NID, tax and bank identifiers). Matched on the catalogue's
 * standard key, so an alias of one of these is restricted too.
 */
export const RESTRICTED_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'PASSPORT',
  'SPOUSE_PASSPORT',
  'HOST_PASSPORT',
  'NID',
  'TAX_RETURN',
  'TIN_CERTIFICATE',
  'TAX_RESIDENCY_CERTIFICATE',
  'TAX_ACKNOWLEDGEMENT_SLIP',
  'BANK_STATEMENT',
  'BUSINESS_BANK_STATEMENT',
  'HOST_BANK_STATEMENT',
  'BANK_REFERENCE_LETTER',
]);

export function isRestrictedDocumentType(docType: string | null): boolean {
  if (!docType) return false;
  const key = resolveDocumentType(docType)?.key ?? docType;
  return RESTRICTED_DOCUMENT_TYPES.has(key);
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
          ...(isRestrictedDocumentType(document.docType) ? { restricted: true } : {}),
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

/**
 * CAS-08 contributor check. The request must be in flight for this account
 * and applicant (the same rule documents.ts applies), and the resource must
 * sit inside that one request: its case, or the document handed over under
 * it. Never the applicant as a whole (policy law 5), never another case, and
 * never a document from an earlier request.
 */
async function contributorPermits(
  tx: Db,
  principal: AccountPrincipal,
  action: PermissionAction,
  loaded: LoadedResource,
  contributorRequestId: string,
): Promise<boolean> {
  if (!CONTRIBUTOR_ACTIONS.includes(action) || !isUuid(contributorRequestId)) return false;
  const { resource } = loaded;
  if (resource.kind === 'applicant') return false;
  const request: ContributorRequest | undefined = first(
    await tx
      .select()
      .from(schema.contributorRequests)
      .where(eq(schema.contributorRequests.id, contributorRequestId))
      .limit(1),
  );
  if (
    !request ||
    !isInFlightContributorRow(request, {
      actorAccountId: principal.accountId,
      applicantId: loaded.applicant.id,
    })
  ) {
    return false;
  }
  if (resource.kind === 'mission') return request.missionId === resource.mission.id;

  // A document belongs to this request only if this contributor uploaded it
  // as contributor evidence of the requested type after claiming this
  // request, and no other request already holds it. The claim time is
  // compared with the row's database-set creation time, so a document from
  // an earlier request can never qualify (clock skew fails closed).
  const { document } = resource;
  if (
    request.submittedAt === null ||
    document.uploaderAccountId !== principal.accountId ||
    document.source !== 'CONTRIBUTOR' ||
    document.docType !== request.docType ||
    document.createdAt.getTime() < request.submittedAt.getTime()
  ) {
    return false;
  }
  const heldElsewhere = first(
    await tx
      .select({ id: schema.contributorRequests.id })
      .from(schema.contributorRequests)
      .where(
        and(
          eq(schema.contributorRequests.submittedDocumentId, document.id),
          ne(schema.contributorRequests.id, request.id),
        ),
      )
      .limit(1),
  );
  return heldElsewhere === undefined;
}

/**
 * Authorize `principal` to perform `action` on one applicant-owned record.
 *
 * Resolution, all from live state:
 * - the applicant's owner;
 * - an in-flight CAS-08 contributor (only with `contributorRequestId`, only
 *   for `CONTRIBUTOR_ACTIONS`, only inside that request's case);
 * - each of the account's organization memberships, judged only against
 *   grants made to that organization (the policy engine itself denies an
 *   inactive membership or a suspended or closed organization, SHR-02);
 * - the account as a direct individual recipient, judged only against grants
 *   made to the account personally.
 * `actingFor` restricts the last two to one relationship. Without it, if
 * more than one relationship would allow the request the result is
 * `invalid`, never a silent pick.
 *
 * With `asSupport` only approved just-in-time support grants are
 * considered, never ordinary sharing grants. System and staff principals are
 * refused here: they act through `SystemScope` and `StaffScope`.
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
  if (principal.kind !== 'account') return err(denied('default_deny'));
  if (!isUuid(principal.accountId)) return err(denied('default_deny'));
  if (!isUuid(target.id)) return err(serviceError('not_found', 'record not found'));

  const loaded = await loadResource(tx, target.key, target.id);
  if (!loaded) return err(serviceError('not_found', 'record not found'));

  const { applicant, policyResource } = loaded;
  // Always the real time: a caller-chosen clock could revive an expired grant.
  const now = new Date();
  const stepUpSatisfied = StepUpProof.covers(opts.stepUp, {
    accountId: principal.accountId,
    action,
    resourceId: target.id,
  });
  const accountId = principal.accountId as AccountId;
  const issue = (actor: AccessActor): AuthorizedApplicant<A> =>
    mint({ tx, applicant, actor, resource: loaded.resource, action, purpose: opts.purpose });
  const evaluate = (actor: Actor, grants: readonly PolicyGrant[]): Decision =>
    decide(actor, action, policyResource, grants, opts.purpose, now, stepUpSatisfied);

  if (principal.asSupport === true) {
    const actor: Actor = { kind: 'support_admin', accountId };
    const decision = evaluate(actor, await loadSupportGrantsForPolicy(tx, applicant.id));
    if (!decision.allowed) return err(denied(decision.reason));
    return ok(issue(actor));
  }

  if (applicant.ownerAccountId === principal.accountId) {
    const actor: Actor = { kind: 'applicant_owner', applicantId: applicant.id as ApplicantId };
    const decision = evaluate(actor, []);
    if (!decision.allowed) return err(denied(decision.reason));
    return ok(issue(actor));
  }

  if (
    opts.contributorRequestId !== undefined &&
    (await contributorPermits(tx, principal, action, loaded, opts.contributorRequestId))
  ) {
    return ok(
      issue({ kind: 'contributor', accountId, contributorRequestId: opts.contributorRequestId }),
    );
  }

  const [grants, memberships] = await Promise.all([
    loadGrantsForPolicy(tx, applicant.id),
    listMembershipsForAccount(tx, principal.accountId),
  ]);
  const actingFor = opts.actingFor;
  const candidates: { actor: Actor; grants: readonly PolicyGrant[] }[] = [];
  for (const membership of memberships) {
    const organizationId = membership.organization.id;
    if (
      actingFor !== undefined &&
      (actingFor === 'individual' || actingFor.organizationId !== organizationId)
    ) {
      continue;
    }
    candidates.push({
      actor: {
        kind: 'organization_member',
        accountId,
        membership: {
          organizationId: organizationId as AgencyId,
          role: membership.role,
          active: membership.active,
          organizationActive: membership.organization.status === 'ACTIVE',
        },
      },
      grants: grants.filter((g) => g.recipientOrganizationId === organizationId),
    });
  }
  if (actingFor === undefined || actingFor === 'individual') {
    candidates.push({
      actor: { kind: 'individual_recipient', accountId },
      grants: grants.filter(
        (g) => g.recipientAccountId === accountId && g.recipientOrganizationId === undefined,
      ),
    });
  }

  const allowed: Actor[] = [];
  let reason: DenyReason | undefined;
  for (const candidate of candidates) {
    const decision = evaluate(candidate.actor, candidate.grants);
    if (decision.allowed) allowed.push(candidate.actor);
    else reason = pickReason(reason, decision.reason);
  }
  const [only, ...others] = allowed;
  if (only !== undefined && others.length === 0) return ok(issue(only));
  if (only !== undefined) {
    return err(
      serviceError(
        'invalid',
        'more than one relationship allows this; say which organization (or individual access) to act for',
      ),
    );
  }
  return err(denied(reason ?? 'default_deny'));
}
