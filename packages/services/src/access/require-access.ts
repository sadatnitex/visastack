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
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { type Applicant, getApplicant } from '../applicants';
import { type ContributorRequest, isInFlightContributorRow } from '../contributor-requests';
import { type Db, first, schema } from '../db';
import { type ServiceError, serviceError } from '../errors';
import { listMembershipsForAccount } from '../organizations';
import { documentCategory, toPolicyGrant } from '../sharing';
import { loadSupportGrantsForPolicy } from '../support-access';
import { loadCaseExclusions } from './grant-scope';
import type { AccountPrincipal, Principal } from './principal';
import {
  type DocumentProtectionSettings,
  documentTypeRestricted,
  loadDocumentProtectionSettings,
} from './restricted-documents';
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

/** Freezes every nested record, so a proof's applicant or document cannot be changed after it is issued. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
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
    this.applicant = deepFreeze(fields.applicant);
    this.actor = fields.actor;
    this.resource = deepFreeze(fields.resource);
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
  /**
   * Hears the precise reason for a refusal, for audit and logs only. The returned error never
   * carries it: every refusal returns the same `ACCESS_REFUSAL` (see `requireAccess`). Called at
   * most once, synchronously, just before the refusal is returned; anything it throws is ignored,
   * so it can never change the answer.
   */
  readonly onRefused?: (refusal: AccessRefusal) => void;
}

/**
 * Why `requireAccess` refused, for audit and logs only. `recordExists` says whether the named
 * record is real, which is exactly what the caller must never learn from the answer.
 */
export interface AccessRefusal {
  readonly reason: DenyReason | 'not_found' | 'malformed_id' | 'not_an_account';
  readonly recordExists: boolean;
}

/** The internal log line for a refusal: never shown, never returned. */
export function accessRefusalDetail(refusal: AccessRefusal): string {
  return `access denied (${refusal.reason})`;
}

/**
 * The one answer every refused caller gets, whatever the reason: a made-up or malformed id, a real
 * record of someone else, access that was revoked, paused, expired or never covered this case, an
 * agency without a grant, or a caller that is not a signed-in account. Its words are the ones a
 * made-up id always had. Frozen, and copied for each refusal, so no caller can change it for the
 * next one.
 */
export const ACCESS_REFUSAL: ServiceError = Object.freeze(
  serviceError('not_found', 'record not found'),
);

/**
 * Document types whose preview or download needs a recent identity
 * confirmation: identity, tax and bank documents (SEC-03 names passport,
 * NID, tax and bank identifiers) and, by owner decision 2026-10-25, every
 * medical document: the whole medical category plus the medical types filed
 * elsewhere. Matched on the catalogue's standard key, so an alias of one of
 * these is restricted too.
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
  'JOINT_ACCOUNT_STATEMENT',
  'APPROVED_MEDICAL_CENTRE_RESULT',
  'OTHER_MEDICAL_DOCUMENT',
]);

/**
 * Every document type in these catalogue categories or groups is restricted,
 * including ones added later: medical documents; identity and civil-status
 * documents (passports, ID cards, birth, marriage, refugee and similar papers);
 * and, by owner decision 2026-10-25, every financial document (statements,
 * tax, income, loans, cards, property and sponsorship papers).
 */
export const RESTRICTED_DOCUMENT_CATEGORIES: ReadonlySet<string> = new Set([
  'medical',
  'identity_civil',
  'financial',
]);

/**
 * Fails closed: a document whose type is not known yet (not classified, or a
 * name the catalogue does not recognise) is treated as restricted, because it
 * could be a passport or a medical scan.
 */
export function isRestrictedDocumentType(
  docType: string | null,
  settings: DocumentProtectionSettings = DEFAULT_DOCUMENT_PROTECTION,
): boolean {
  return documentTypeRestricted(docType, settings);
}

/**
 * The built-in rule above, as settings. Platform admins can switch any part
 * of it on or off (document-protection.ts); an absent switch means this.
 */
export const DEFAULT_DOCUMENT_PROTECTION: DocumentProtectionSettings = Object.freeze({
  restrictedCategories: RESTRICTED_DOCUMENT_CATEGORIES,
  restrictedTypes: RESTRICTED_DOCUMENT_TYPES,
  unrestrictedTypes: new Set<string>(),
  unknownTypesRestricted: true,
});

// Lower case only, as the database writes them: string comparisons and uuid
// comparisons then always agree.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

/**
 * Stands in for the applicant of a record that does not exist, so the lookups after it still run:
 * no applicant, grant or contributor request ever has this id.
 */
const NO_APPLICANT = '00000000-0000-0000-0000-000000000000';

/**
 * Loads the record and its applicant. A record that does not exist sends the same statements as one
 * that does (its applicant is looked up under `NO_APPLICANT`, and a document's protection switches
 * are read either way), so the work done cannot tell the two apart.
 */
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
      const applicant = await getApplicant(tx, mission?.applicantId ?? NO_APPLICANT);
      if (!mission || !applicant) return undefined;
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
      const applicant = await getApplicant(tx, document?.applicantId ?? NO_APPLICANT);
      // The rule as platform admins have set it, read in this transaction;
      // every document restricted if it cannot be read.
      const protection = await loadDocumentProtectionSettings(tx, DEFAULT_DOCUMENT_PROTECTION);
      if (!document || !applicant) return undefined;
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
          ...(isRestrictedDocumentType(document.docType, protection) ? { restricted: true } : {}),
        },
      };
    }
  }
}

/**
 * The grants on this applicant that could ever reach this caller: made to the account itself, or
 * to an organization the account belongs to (read in the same statement). The access gate judges a
 * caller only against these, exactly as it did against the full list, so its answer is the same.
 * Reading only these, and always reading the case exceptions, means the statements sent never
 * depend on anyone's grants: a record that does not exist, a real record of someone else and a
 * case hidden from this caller by an exception all take the same database work.
 */
async function loadRecipientGrantsForPolicy(
  db: Db,
  applicantId: string,
  accountId: string,
): Promise<PolicyGrant[]> {
  const ownOrganizations = db
    .select({ id: schema.memberships.organizationId })
    .from(schema.memberships)
    .where(eq(schema.memberships.accountId, accountId));
  const rows = await db
    .select()
    .from(schema.grants)
    .where(
      and(
        eq(schema.grants.applicantId, applicantId),
        or(
          eq(schema.grants.recipientAccountId, accountId),
          inArray(schema.grants.recipientOrganizationId, ownOrganizations),
        ),
      ),
    );
  const exclusions = await loadCaseExclusions(db, { applicantId });
  return rows.map((row) => toPolicyGrant(row, exclusions.get(row.id)));
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

/** The step-up answer: only for a caller who is otherwise allowed, so it reveals nothing. */
function stepUpRequired(): ServiceError {
  return serviceError('step_up_required', 'this action requires reauthentication');
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
  key: RefKey,
  applicantId: string,
  loaded: LoadedResource | undefined,
  contributorRequestId: string,
): Promise<boolean> {
  // Decided from the request alone (never from the record), so a missing record takes the same path.
  if (!CONTRIBUTOR_ACTIONS.includes(action) || !isUuid(contributorRequestId)) return false;
  if (key === 'applicantId') return false;
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
      applicantId,
    }) ||
    // A claimed request still ends when its link expires.
    request.expiresAt.getTime() <= Date.now() ||
    // No record: `applicantId` is `NO_APPLICANT`, which no request names, so this is unreachable.
    loaded === undefined
  ) {
    return false;
  }
  const { resource } = loaded;
  if (resource.kind === 'applicant') return false;
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
 * Every refusal is the same `ACCESS_REFUSAL` (`not_found`, "record not found"): an unknown or
 * malformed id, a real record of someone else, revoked, paused or expired access, a grant that does
 * not cover this case or action, an agency without a grant, and a principal that is not a signed-in
 * account all look alike, so no caller can pass on whether a record exists. The precise reason goes
 * only to `opts.onRefused`, for audit and logs. Two answers differ, and only for a caller who is
 * otherwise allowed: `step_up_required` (reauthenticate first) and `invalid` when more than one
 * relationship would allow the request.
 *
 * A well-formed id that names no record does the same database work as a real record the caller
 * may not use: the same lookups run, with `NO_APPLICANT` standing in for the missing applicant, and
 * only this caller's own grants are read.
 */
export async function requireAccess<A extends PermissionAction>(
  tx: Db,
  principal: Principal,
  action: A,
  ref: ApplicantResourceRef,
  opts: RequireAccessOptions,
): Promise<Result<AuthorizedApplicant<A>, ServiceError>> {
  const refuse = (
    reason: AccessRefusal['reason'],
    recordExists: boolean,
  ): Result<never, ServiceError> => {
    try {
      // A listener that returns a promise (an audit write, say) may fail later: that is swallowed
      // too, never left as an unhandled rejection.
      const heard: unknown = opts.onRefused?.({ reason, recordExists });
      if (heard instanceof Promise) heard.catch(() => undefined);
    } catch {
      // The answer never depends on whoever listens for the reason.
    }
    return err({ ...ACCESS_REFUSAL });
  };

  const target = refTarget(ref);
  if (!target) {
    return err(serviceError('invalid', 'name exactly one applicant, case or document'));
  }
  if (principal.kind !== 'account' || !isUuid(principal.accountId)) {
    return refuse('not_an_account', false);
  }
  if (!isUuid(target.id)) return refuse('malformed_id', false);
  // Previews and downloads are decided one document at a time, so the
  // restricted-document rule and the step-up binding always apply.
  if ((action === 'PREVIEW' || action.startsWith('DOWNLOAD_')) && target.key !== 'documentId') {
    return err(
      serviceError('invalid', 'previews and downloads are checked one document at a time'),
    );
  }

  const loaded = await loadResource(tx, target.key, target.id);
  const applicantId = loaded?.applicant.id ?? NO_APPLICANT;
  // Always the real time: a caller-chosen clock could revive an expired grant.
  const now = new Date();
  const stepUpSatisfied = StepUpProof.covers(opts.stepUp, {
    accountId: principal.accountId,
    action,
    resourceId: target.id,
  });
  const accountId = principal.accountId as AccountId;
  const policyResource: PolicyResource = loaded?.policyResource ?? {
    applicantId: NO_APPLICANT as ApplicantId,
  };
  const evaluate = (actor: Actor, grants: readonly PolicyGrant[]): Decision =>
    decide(actor, action, policyResource, grants, opts.purpose, now, stepUpSatisfied);
  /** A refusal of a real record: step-up keeps its own answer (the caller is otherwise allowed). */
  const deny = (reason: DenyReason) =>
    reason === 'step_up_required' ? err(stepUpRequired()) : refuse(reason, true);
  /** Turns a decision into the answer. Only a real record is ever issued. */
  const answer = (actor: AccessActor, decision: Decision) => {
    if (!loaded) return refuse('not_found', false);
    if (!decision.allowed) return deny(decision.reason);
    return ok(
      mint({
        tx,
        applicant: loaded.applicant,
        actor,
        resource: loaded.resource,
        action,
        purpose: opts.purpose,
      }),
    );
  };

  if (principal.asSupport === true) {
    const actor: Actor = { kind: 'support_admin', accountId };
    return answer(actor, evaluate(actor, await loadSupportGrantsForPolicy(tx, applicantId)));
  }

  if (loaded !== undefined && loaded.applicant.ownerAccountId === principal.accountId) {
    const actor: Actor = { kind: 'applicant_owner', applicantId: applicantId as ApplicantId };
    return answer(actor, evaluate(actor, []));
  }

  if (
    opts.contributorRequestId !== undefined &&
    (await contributorPermits(
      tx,
      principal,
      action,
      target.key,
      applicantId,
      loaded,
      opts.contributorRequestId,
    ))
  ) {
    return answer(
      { kind: 'contributor', accountId, contributorRequestId: opts.contributorRequestId },
      { allowed: true },
    );
  }

  // Only the grants that could reach this caller: other people's grants never change what is
  // read, so a missing record, a foreign one and a hidden case do the same work.
  const [grants, memberships] = await Promise.all([
    loadRecipientGrantsForPolicy(tx, applicantId, principal.accountId),
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
      // A grant to this organization only; one that also names a person
      // reaches that person alone, never every member.
      grants: grants.filter(
        (g) =>
          g.recipientOrganizationId === organizationId &&
          (g.recipientAccountId === undefined || g.recipientAccountId === accountId),
      ),
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
  if (!loaded) return refuse('not_found', false);
  const [only, ...others] = allowed;
  if (only !== undefined && others.length === 0) return answer(only, { allowed: true });
  if (only !== undefined) {
    return err(
      serviceError(
        'invalid',
        'more than one relationship allows this; say which organization (or individual access) to act for',
      ),
    );
  }
  return deny(reason ?? 'default_deny');
}
