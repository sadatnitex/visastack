import type {
  AccountId,
  AgencyId,
  ApplicantId,
  DocumentId,
  MembershipRole,
  MissionId,
  MissionState,
  PermissionAction,
  Result,
} from '@visastack/core';
import { err, ok, parseReferenceCode } from '@visastack/core';
import {
  type Actor,
  type Grant as PolicyGrant,
  type Resource as PolicyResource,
  authorize,
} from '@visastack/policy';
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { listVisibleMissionsForMember } from '../agency';
import { agencyAiAvailable } from '../agency-ai-ready';
import { type Db, first, schema } from '../db';
import { resolveEntitlements } from '../entitlements';
import { findReferenceEntity, referenceCodesFor } from '../reference-codes';
import { documentCategory, toPolicyGrant } from '../sharing';
import { loadCaseExclusions, withCaseExclusions } from './grant-scope';
import { accountPrincipal } from './principal';
import { type AuthorizedApplicant, EACH_GRANT, requireAccess } from './require-access';

/**
 * The agency AI scope (S22, ADR 0021 S22 amendment): the only way an agency's AI connection
 * reaches a traveller's record.
 *
 * An agency connection speaks for one agency member (decision D1: an owner or admin) acting for
 * that agency. It reaches a traveller only through grants that traveller made to that agency
 * (a grant naming one person counts only for that person) holding both `AI_ASSIST` ("Let This
 * Agency Use AI Tools on What I Share") and `VIEW_METADATA`. These are the AI grants. Every read
 * is judged against the AI grants alone, through the policy engine (`authorize`), never against
 * any other grant the agency holds:
 *
 * - a profile detail: `VIEW_METADATA` on the record with the detail's category;
 * - a document: `VIEW_METADATA` on that document (its id and category);
 * - a document's text: `PREVIEW` on that document, never for a restricted type;
 * - a case: the member can see it (`listVisibleMissionsForMember`) and an AI grant covers it
 *   (`grantCoversMission`, with per-case exceptions), for `VIEW_METADATA`.
 *
 * Purpose: an AI grant is judged against its own declared purpose (`EACH_GRANT`), because grant
 * purposes are free text and an `ai_connection` purpose would never match one (finding 1).
 * `ai_connection` stays the purpose recorded in the audit.
 *
 * Everything is read again on every call, inside the call's transaction: the membership and its
 * role, the agency's status and billing, its setting, the connection's age, the grants and their
 * exceptions. Nothing is cached between calls, so revoking, pausing, expiry, an exception or
 * turning `AI_ASSIST` off stops the very next call (law 6).
 *
 * A scope is minted here only, after the access gate allowed the member for that traveller's
 * case: a copy or a made-up object is never accepted (`AgencyAiScope.isGenuine`).
 */

/** Decision D1: only these roles may connect, and keep using, an AI app for the agency. */
export const AGENCY_AI_ROLES: readonly MembershipRole[] = ['OWNER', 'ADMIN'];

/** Decision D4: an agency connection lasts at most 30 days, then the agency connects again. */
export const AGENCY_AI_CONNECTION_MAX_MS = 30 * 24 * 60 * 60 * 1000;

/** The text form of the new permission, compared as text in SQL so it works before 0108. */
export const AI_ASSIST_ACTION: PermissionAction = 'AI_ASSIST';

/** Why an agency connection's call was refused before any traveller was reached. */
export type AgencyAiStandingRefusal =
  /** The two S22 migrations have not run. */
  | 'not_available'
  /** The member left, was turned off, or is no longer an owner or admin. */
  | 'agency_member_ended'
  /** The agency is not active (suspended, rejected, closed or not verified). */
  | 'agency_not_active'
  /** The agency's billing is Suspended (decision D6: AI is additive, so it pauses). */
  | 'agency_billing_suspended'
  /** "AI Connections for This Agency" is off. */
  | 'agency_setting_off'
  /** The connection is older than 30 days (decision D4). */
  | 'agency_connection_expired';

/** Why one traveller's case was not reached. */
export type AgencyAiCaseRefusal =
  /** Unknown, not visible to the member, or no AI grant covers it: one answer for all. */
  | 'case_not_shared'
  /** The member personally owns this record: an agency connection never reads it as the owner. */
  | 'agency_own_record';

/** A member whose standing was just checked, for one call. Made only here. */
export interface AgencyAiMember {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly accountId: string;
  readonly role: MembershipRole;
  /** The connection this call is for; null while a new one is being made. */
  readonly connectionId: string | null;
}
const MEMBERS = new WeakSet<object>();

function isGenuineMember(value: unknown): value is AgencyAiMember {
  return typeof value === 'object' && value !== null && MEMBERS.has(value);
}

/** Whether the agency's own setting is on. A missing table or row means off. */
export async function agencyAiSettingOn(db: Db, organizationId: string): Promise<boolean> {
  if (!(await agencyAiAvailable(db))) return false;
  const row = first(
    await db
      .select({ on: schema.organizationAiSettings.aiConnectionsEnabled })
      .from(schema.organizationAiSettings)
      .where(eq(schema.organizationAiSettings.organizationId, organizationId))
      .limit(1),
  );
  return row?.on === true;
}

/**
 * The member's standing for one call of an agency connection, read live: the migrations, an
 * active owner or admin membership, an active agency whose billing is not Suspended, the agency's
 * setting on, and a connection no older than 30 days. The AI feature (Agency AI Tools) is checked
 * by the AI gate itself, which also counts the call.
 */
export async function checkAgencyAiStanding(
  tx: Db,
  input: {
    /** Null while a new connection is being made (its age is then nothing). */
    readonly connectionId: string | null;
    readonly organizationId: string;
    readonly accountId: string;
    readonly connectionCreatedAt: Date;
    readonly now: Date;
  },
): Promise<Result<AgencyAiMember, AgencyAiStandingRefusal>> {
  if (!(await agencyAiAvailable(tx))) return err('not_available');
  const row = first(
    await tx
      .select({
        role: schema.memberships.role,
        active: schema.memberships.active,
        status: schema.organizations.status,
        name: schema.organizations.name,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.memberships.organizationId),
      )
      .where(
        and(
          eq(schema.memberships.accountId, input.accountId),
          eq(schema.memberships.organizationId, input.organizationId),
        ),
      )
      .limit(1),
  );
  if (!row || !row.active || !AGENCY_AI_ROLES.includes(row.role)) {
    return err('agency_member_ended');
  }
  if (row.status !== 'ACTIVE') return err('agency_not_active');
  // Billing status through the one entitlement resolver, the reader every limit uses.
  const entitlements = await resolveEntitlements(tx, { organizationId: input.organizationId });
  if (entitlements.billingStatus === 'SUSPENDED') return err('agency_billing_suspended');
  if (!(await agencyAiSettingOn(tx, input.organizationId))) return err('agency_setting_off');
  if (input.now.getTime() - input.connectionCreatedAt.getTime() > AGENCY_AI_CONNECTION_MAX_MS) {
    return err('agency_connection_expired');
  }
  const member: AgencyAiMember = Object.freeze({
    organizationId: input.organizationId,
    organizationName: row.name,
    accountId: input.accountId,
    role: row.role,
    connectionId: input.connectionId,
  });
  MEMBERS.add(member);
  return ok(member);
}

interface AiGrant {
  readonly id: string;
  readonly policy: PolicyGrant;
}

/**
 * The traveller's AI grants for this member: grants to the agency (one that names a person counts
 * only for that person) holding both `AI_ASSIST` and `VIEW_METADATA`, each with its per-case
 * exceptions, read live. Status, start, expiry and acceptance are judged later by the policy
 * engine on every read, never here.
 */
async function loadAiGrants(
  tx: Db,
  applicantIds: readonly string[],
  member: AgencyAiMember,
): Promise<Map<string, AiGrant[]>> {
  const byApplicant = new Map<string, AiGrant[]>();
  if (applicantIds.length === 0) return byApplicant;
  // One query for every traveller, and one for their exceptions.
  const rows = await tx
    .select()
    .from(schema.grants)
    .where(
      and(
        inArray(schema.grants.applicantId, [...new Set(applicantIds)]),
        eq(schema.grants.recipientOrganizationId, member.organizationId),
        // As text, so this reads the same before the enum value exists (it then matches nothing).
        sql`${AI_ASSIST_ACTION} = any(${schema.grants.actions}::text[])`,
      ),
    );
  const forMember = rows.filter(
    (row) =>
      (row.recipientAccountId === null || row.recipientAccountId === member.accountId) &&
      (row.actions as readonly string[]).includes(AI_ASSIST_ACTION) &&
      (row.actions as readonly string[]).includes('VIEW_METADATA'),
  );
  const exclusions = await loadCaseExclusions(tx, { grantIds: forMember.map((row) => row.id) });
  for (const row of forMember) {
    const list = byApplicant.get(row.applicantId) ?? [];
    list.push({ id: row.id, policy: toPolicyGrant(row, exclusions.get(row.id)) });
    byApplicant.set(row.applicantId, list);
  }
  return byApplicant;
}

let minting = false;
let mint: (fields: ScopeFields) => AgencyAiScope;

interface ScopeFields {
  readonly member: AgencyAiMember;
  readonly applicantId: string;
  readonly grants: readonly AiGrant[];
  readonly visibleCases: ReadonlySet<string>;
  readonly now: Date;
}

/**
 * What one agency AI call may read of one traveller's record. Only `openAgencyAiScope` makes one,
 * after the access gate allowed the member for that traveller's case.
 */
export class AgencyAiScope {
  readonly #fields: ScopeFields;
  readonly organizationId: string;
  readonly accountId: string;
  readonly applicantId: string;
  readonly connectionId: string | null;
  /** The AI grants every read was judged against, for the audit record. */
  readonly grantIds: readonly string[];

  private constructor(fields: ScopeFields) {
    if (!minting) throw new Error('an AgencyAiScope can only be issued by openAgencyAiScope()');
    this.#fields = fields;
    this.organizationId = fields.member.organizationId;
    this.accountId = fields.member.accountId;
    this.applicantId = fields.applicantId;
    this.connectionId = fields.member.connectionId;
    this.grantIds = Object.freeze(fields.grants.map((grant) => grant.id).sort());
    Object.freeze(this);
  }

  /** Run-time check that `value` is a genuine scope, not a copy. */
  static isGenuine(value: unknown): value is AgencyAiScope {
    return typeof value === 'object' && value !== null && #fields in value;
  }

  static {
    mint = (fields: ScopeFields): AgencyAiScope => {
      minting = true;
      try {
        return new AgencyAiScope(fields);
      } finally {
        minting = false;
      }
    };
  }

  /** Whether any AI grant, each on its own purpose, allows `action` on `resource` for the member. */
  permits(action: PermissionAction, resource: Omit<PolicyResource, 'applicantId'>): boolean {
    const { member, applicantId, grants, now } = this.#fields;
    const actor: Actor = {
      kind: 'organization_member',
      accountId: member.accountId as AccountId,
      membership: {
        organizationId: member.organizationId as AgencyId,
        role: member.role,
        // Checked live for this call by `checkAgencyAiStanding`.
        active: true,
        organizationActive: true,
      },
    };
    const full: PolicyResource = { ...resource, applicantId: applicantId as ApplicantId };
    return grants.some(
      (grant) =>
        authorize({
          actor,
          action,
          resource: full,
          context: {
            now,
            purpose: grant.policy.purpose,
            stepUpSatisfied: false,
            grants: [grant.policy],
          },
        }).allowed,
    );
  }

  /** A profile detail of this category (its pack), or of none. */
  factAllowed(category: string | null): boolean {
    return this.permits('VIEW_METADATA', category ? { category } : {});
  }

  /** One document: listed, its dates and status, and named as a source of a detail. */
  documentAllowed(document: { readonly id: string; readonly docType: string | null }): boolean {
    const category = documentCategory(document.docType);
    return this.permits('VIEW_METADATA', {
      documentId: document.id as DocumentId,
      ...(category !== undefined ? { category } : {}),
    });
  }

  /** One document's text: `PREVIEW`, and never a restricted type (the caller says which are). */
  documentTextAllowed(document: {
    readonly id: string;
    readonly docType: string | null;
    readonly restricted: boolean;
  }): boolean {
    if (document.restricted) return false;
    const category = documentCategory(document.docType);
    return this.permits('PREVIEW', {
      documentId: document.id as DocumentId,
      ...(category !== undefined ? { category } : {}),
    });
  }

  /** One case: the member can see it and an AI grant covers it (exceptions included). */
  caseAllowed(missionId: string): boolean {
    return (
      this.#fields.visibleCases.has(missionId) &&
      this.permits('VIEW_METADATA', { missionId: missionId as MissionId })
    );
  }
}

/**
 * Whether the member sees this one case in the agency's own views, checked directly (the same rule
 * as `listVisibleMissionsForMember`, for one case): an active, accepted, unexpired grant to the
 * agency reaches it (per-case exceptions included), and a member who is not an owner or admin is
 * also assigned to it.
 */
async function memberSeesCase(tx: Db, member: AgencyAiMember, missionId: string): Promise<boolean> {
  const now = new Date();
  const covered = await withCaseExclusions(tx, (covers) =>
    tx
      .select({ id: schema.grants.id })
      .from(schema.grants)
      .innerJoin(schema.missions, eq(schema.missions.applicantId, schema.grants.applicantId))
      .where(
        and(
          eq(schema.missions.id, missionId),
          eq(schema.grants.recipientOrganizationId, member.organizationId),
          eq(schema.grants.status, 'ACTIVE'),
          isNotNull(schema.grants.acceptedAt),
          lte(schema.grants.startAt, now),
          or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
          covers(schema.missions.id),
        ),
      )
      .limit(1),
  );
  if (covered.length === 0) return false;
  if (AGENCY_AI_ROLES.includes(member.role)) return true;
  const assigned = await tx
    .select({ id: schema.assignments.id })
    .from(schema.assignments)
    .where(
      and(
        eq(schema.assignments.organizationId, member.organizationId),
        eq(schema.assignments.memberAccountId, member.accountId),
        eq(schema.assignments.missionId, missionId),
      ),
    )
    .limit(1);
  return assigned.length > 0;
}

/**
 * Opens one traveller's record for one agency AI call, through one of their cases: the access gate
 * acting for the agency (`requireAccess`, `VIEW_METADATA` on the case, each grant on its own
 * purpose), the actor must be a member of that agency (never the record's owner), and the case
 * must be one the member can see and an AI grant covers. Anything else is `case_not_shared`, the
 * same answer as an unknown case.
 */
export async function openAgencyAiScope(
  tx: Db,
  member: AgencyAiMember,
  input: { readonly missionId: string; readonly now: Date },
): Promise<
  Result<
    { readonly scope: AgencyAiScope; readonly proof: AuthorizedApplicant<'VIEW_METADATA'> },
    AgencyAiCaseRefusal
  >
> {
  if (!isGenuineMember(member)) return err('case_not_shared');
  const access = await requireAccess(
    tx,
    accountPrincipal(member.accountId),
    'VIEW_METADATA',
    { missionId: input.missionId },
    { actingFor: { organizationId: member.organizationId }, purpose: EACH_GRANT },
  );
  if (!access.ok) return err('case_not_shared');
  const proof = access.value;
  // The owner is tried first by the gate: a member who owns the record never reads it this way.
  if (proof.actor.kind === 'applicant_owner') return err('agency_own_record');
  if (
    proof.actor.kind !== 'organization_member' ||
    proof.actor.accountId !== member.accountId ||
    proof.actor.membership.organizationId !== member.organizationId ||
    proof.resource.kind !== 'mission'
  ) {
    return err('case_not_shared');
  }
  const applicantId = proof.applicant.id;
  const [grants, sees] = await Promise.all([
    loadAiGrants(tx, [applicantId], member),
    memberSeesCase(tx, member, input.missionId),
  ]);
  const scope = mint({
    member,
    applicantId,
    grants: grants.get(applicantId) ?? [],
    visibleCases: new Set(sees ? [input.missionId] : []),
    now: input.now,
  });
  if (!scope.caseAllowed(input.missionId)) return err('case_not_shared');
  return ok({ scope, proof });
}

/** One case an agency AI connection may reach, as `list_cases` shows it. */
export interface AgencyAiCase {
  readonly missionId: string;
  readonly applicantId: string;
  readonly referenceCode: string | null;
  readonly title: string;
  readonly travellerName: string;
  readonly destination: string | null;
  readonly state: MissionState;
  readonly targetDeadline: string | null;
  readonly travelStartDate: string | null;
  /** The traveller's AI grants that reach this case, for the audit record. */
  readonly grantIds: readonly string[];
}

/** The most cases one agency `list_cases` answer names; newest first. */
export const AGENCY_AI_MAX_CASES = 50;

/**
 * Every case this member can see in the agency and an AI grant of that case's traveller covers,
 * newest first, for `list_cases`. A traveller the member personally owns is left out (the agency
 * connection never reads a member's own record). Judged per case with the same rules as
 * `openAgencyAiScope`.
 */
export async function listAgencyAiCases(
  tx: Db,
  member: AgencyAiMember,
  now: Date,
): Promise<{ readonly cases: readonly AgencyAiCase[]; readonly notShown: number }> {
  if (!isGenuineMember(member)) return { cases: [], notShown: 0 };
  const visible = await listVisibleMissionsForMember(tx, member.organizationId, member.accountId);
  const byApplicant = new Map<string, typeof visible.missions>();
  for (const mission of visible.missions) {
    const list = byApplicant.get(mission.applicantId) ?? [];
    list.push(mission);
    byApplicant.set(mission.applicantId, list);
  }
  if (byApplicant.size === 0) return { cases: [], notShown: 0 };
  const owners = await tx
    .select({ id: schema.applicants.id, owner: schema.applicants.ownerAccountId })
    .from(schema.applicants)
    .where(inArray(schema.applicants.id, [...byApplicant.keys()]));
  const ownedByMember = new Set(
    owners.filter((row) => row.owner === member.accountId).map((row) => row.id),
  );
  const reachable: ((typeof visible.missions)[number] & { grantIds: readonly string[] })[] = [];
  const allGrants = await loadAiGrants(
    tx,
    [...byApplicant.keys()].filter((id) => !ownedByMember.has(id)),
    member,
  );
  for (const [applicantId, missions] of byApplicant) {
    if (ownedByMember.has(applicantId)) continue;
    const grants = allGrants.get(applicantId) ?? [];
    if (grants.length === 0) continue;
    const scope = mint({
      member,
      applicantId,
      grants,
      visibleCases: new Set(missions.map((m) => m.missionId)),
      now,
    });
    for (const mission of missions) {
      if (scope.caseAllowed(mission.missionId)) {
        reachable.push({ ...mission, grantIds: scope.grantIds });
      }
    }
  }
  reachable.sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.missionId.localeCompare(b.missionId),
  );
  const shown = reachable.slice(0, AGENCY_AI_MAX_CASES);
  const codes = await referenceCodesFor(
    tx,
    'C',
    shown.map((m) => m.missionId),
  );
  return {
    cases: shown.map((m) => ({
      missionId: m.missionId,
      applicantId: m.applicantId,
      referenceCode: codes.get(m.missionId) ?? null,
      title: m.title,
      travellerName: m.applicantName,
      destination: m.destination,
      state: m.state,
      targetDeadline: m.targetDeadline,
      travelStartDate: m.travelStartDate,
      grantIds: m.grantIds,
    })),
    notShown: Math.max(0, reachable.length - shown.length),
  };
}

/**
 * The case id a visible reference (`C-XXXXXX`) names, from the registry alone, or null. It says
 * nothing about access: the caller passes the id to `openAgencyAiScope`, which decides, and every
 * refusal there looks the same as an unknown reference.
 */
export async function agencyAiCaseIdFor(tx: Db, reference: string): Promise<string | null> {
  const parsed = parseReferenceCode(reference, 'C');
  if (!parsed.ok) return null;
  return findReferenceEntity(tx, 'C', parsed.code);
}
