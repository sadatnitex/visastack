import type { MembershipRole, OrganizationStatus } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, ilike, inArray, isNull, ne } from 'drizzle-orm';
import { endAgencyAiConnectionsOfMember } from './access/agency-ai-connections';
import { agencyAiAvailable } from './agency-ai-ready';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { checkSeatEntitlement } from './entitlement-enforcement';
import { type ServiceError, serviceError } from './errors';
import { assignFoundingAccess } from './founding-access';
import { cancelQueuedNotificationsForResource } from './notifications';
import {
  type Page,
  type PageRequest,
  clampLimit,
  cursorOrder,
  cursorTime,
  decodeTimeCursor,
  encodeTimeCursor,
  olderThan,
  toPage,
} from './paging';

/**
 * Organizations (agencies) — verification and membership (Build Spec §2;
 * PRD §5).
 *
 * An organization is created PENDING_VERIFICATION and cannot upgrade itself:
 * activation is an independent review (the reviewer must not be a member of the
 * org). Membership roles never grant resource access — that is always a grant
 * (see sharing.ts / the policy engine).
 */

export type Organization = typeof schema.organizations.$inferSelect;
export type Membership = typeof schema.memberships.$inferSelect;

/** True if the account is an active OWNER/ADMIN of the organization. */
export async function isOrgAdmin(
  db: Db,
  accountId: string,
  organizationId: string,
): Promise<boolean> {
  const m = first(
    await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
  return m?.active === true && (m.role === 'OWNER' || m.role === 'ADMIN');
}

async function isMember(db: Db, accountId: string, organizationId: string): Promise<boolean> {
  const m = first(
    await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
  return m !== undefined;
}

/** An organization the account belongs to, with the account's role/active flag. */
export interface OrgMembershipView {
  readonly organization: Organization;
  readonly membershipId: string;
  readonly role: MembershipRole;
  readonly active: boolean;
}

/** Every organization the account is a member of, with its membership. */
export async function listMembershipsForAccount(
  db: Db,
  accountId: string,
): Promise<OrgMembershipView[]> {
  const rows = await db
    .select({
      organization: schema.organizations,
      membershipId: schema.memberships.id,
      role: schema.memberships.role,
      active: schema.memberships.active,
    })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.accountId, accountId));
  return rows.map((row) => ({
    organization: row.organization,
    membershipId: row.membershipId,
    role: row.role,
    active: row.active,
  }));
}

/** Load one organization by id (no scoping — callers enforce membership). */
export async function getOrganization(
  db: Db,
  organizationId: string,
): Promise<Organization | undefined> {
  return first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  );
}

/** How the platform organizations list may be narrowed and paged (WP-SB7). */
export interface OrganizationListOptions extends PageRequest {
  /** Part of the organization's name, any case. Trimmed; at most 100 characters are used. */
  readonly search?: string;
  /** Only organizations in this status. */
  readonly status?: OrganizationStatus;
}

const ORG_SEARCH_MAX = 100;

/**
 * The cursor scope for the organizations list. The filters are part of it, so a cursor made for one
 * search or status gives the first page of another instead of skipping rows.
 */
function organizationsCursorScope(search: string, status: OrganizationStatus | undefined): string {
  return `platform:organizations:${status ?? 'ALL'}:${search}`;
}

/**
 * Every organization (platform-admin overview), newest first. Callers check the platform role.
 * With `options`, one page of at most `limit` (default 50, at most 100) rows comes back, optionally
 * narrowed by a name search and a status; without it, today's full list.
 */
export async function listAllOrganizations(db: Db): Promise<Organization[]>;
export async function listAllOrganizations(
  db: Db,
  options: OrganizationListOptions,
): Promise<Page<Organization>>;
export async function listAllOrganizations(
  db: Db,
  options?: OrganizationListOptions,
): Promise<Organization[] | Page<Organization>> {
  if (!options) {
    const rows = await db.select().from(schema.organizations);
    return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  const search = (options.search ?? '').trim().slice(0, ORG_SEARCH_MAX);
  const status = options.status;
  const limit = clampLimit(options.limit);
  const scope = organizationsCursorScope(search, status);
  const cursor = decodeTimeCursor(options.before, scope);
  const table = schema.organizations;
  const rows = await db
    .select({ organization: table, at: cursorTime(table.createdAt) })
    .from(table)
    .where(
      and(
        search ? ilike(table.name, `%${search.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
        status ? eq(table.status, status) : undefined,
        cursor ? olderThan(table.createdAt, table.id, cursor) : undefined,
      ),
    )
    .orderBy(...cursorOrder(table.createdAt, table.id))
    .limit(limit + 1);
  const page = toPage(rows, limit, (last) =>
    encodeTimeCursor({ at: last.at, id: last.organization.id }, scope),
  );
  return { items: page.items.map((row) => row.organization), nextCursor: page.nextCursor };
}

/** A membership resolved with the member's email, for the org console. */
export interface OrgMemberView {
  readonly membershipId: string;
  readonly accountId: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly active: boolean;
}

/** Members of an organization (org OWNER/ADMIN only), with their emails. */
export async function listOrgMemberships(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<Result<OrgMemberView[], ServiceError>> {
  if (!(await isOrgAdmin(db, actorAccountId, organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can view members'));
  }
  const rows = await db
    .select({
      membershipId: schema.memberships.id,
      accountId: schema.memberships.accountId,
      email: schema.accounts.email,
      role: schema.memberships.role,
      active: schema.memberships.active,
    })
    .from(schema.memberships)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.memberships.accountId))
    .where(eq(schema.memberships.organizationId, organizationId));
  return ok(
    rows.map((r) => ({
      membershipId: r.membershipId,
      accountId: r.accountId,
      email: r.email,
      role: r.role,
      active: r.active,
    })),
  );
}

/** Create an organization (PENDING_VERIFICATION) with the creator as OWNER. */
export async function createOrganization(
  db: Db,
  input: { readonly actorAccountId: string; readonly name: string },
): Promise<Result<Organization, ServiceError>> {
  if (input.name.trim().length === 0) return err(serviceError('invalid', 'a name is required'));
  return db.transaction(async (tx) => {
    const org = required(
      first(await tx.insert(schema.organizations).values({ name: input.name.trim() }).returning()),
      'organization',
    );
    await tx.insert(schema.memberships).values({
      accountId: input.actorAccountId,
      organizationId: org.id,
      role: 'OWNER',
    });
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: org.id,
    });
    await assignFoundingAccess(tx, org.id, input.actorAccountId);
    return ok(org);
  });
}

/**
 * Review a PENDING_VERIFICATION organization (platform-admin action). The
 * reviewer must NOT be a member — an org can never verify itself (Build Spec §2).
 * Step-up gated as "organization verification" (master directive §7 "PR 5"):
 * `stepUpSatisfied` must be honestly derived from a genuine WorkOS
 * reauthentication — see `apps/web/src/lib/step-up.ts`.
 */
export async function reviewOrganization(
  db: Db,
  input: {
    readonly reviewerAccountId: string;
    readonly organizationId: string;
    readonly decision: 'ACTIVE' | 'REJECTED';
    readonly stepUpSatisfied: boolean;
  },
): Promise<Result<Organization, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'reviewing an organization requires reauthentication'),
    );
  }
  const org = first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));
  if (org.status !== 'PENDING_VERIFICATION') {
    return err(serviceError('invalid', 'This application is no longer waiting for review.'));
  }
  if (await isMember(db, input.reviewerAccountId, input.organizationId)) {
    return err(serviceError('forbidden', 'an organization cannot verify itself'));
  }
  return db.transaction(async (tx) => {
    const updated = first(
      await tx
        .update(schema.organizations)
        .set({ status: input.decision, updatedAt: new Date() })
        // Compare-and-set: an application withdrawn after the read above stays withdrawn.
        .where(
          and(
            eq(schema.organizations.id, input.organizationId),
            eq(schema.organizations.status, 'PENDING_VERIFICATION'),
          ),
        )
        .returning(),
    );
    if (!updated) {
      return err(serviceError('invalid', 'This application is no longer waiting for review.'));
    }
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_REVIEWED',
      actorAccountId: input.reviewerAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: updated.id,
      metadata: { decision: input.decision },
    });
    return ok(updated);
  });
}

/**
 * Suspend an ACTIVE organization (platform-admin action). Step-up gated
 * like `reviewOrganization` -- removing an agency's platform access is
 * exactly the kind of consequential action a hijacked session should not
 * be able to trigger with no further check.
 */
export async function suspendOrganization(
  db: Db,
  input: {
    readonly reviewerAccountId: string;
    readonly organizationId: string;
    readonly stepUpSatisfied: boolean;
  },
): Promise<Result<Organization, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'suspending an organization requires reauthentication'),
    );
  }
  const org = first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));
  if (org.status !== 'ACTIVE')
    return err(serviceError('invalid', 'only an ACTIVE org can be suspended'));
  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.organizations)
          .set({ status: 'SUSPENDED', updatedAt: new Date() })
          .where(eq(schema.organizations.id, input.organizationId))
          .returning(),
      ),
      'organization',
    );
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_SUSPENDED',
      actorAccountId: input.reviewerAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: updated.id,
    });
    return ok(updated);
  });
}

/**
 * Terminate an organization (platform-admin action; master directive Part 7
 * §14, PRD PRV-04: "Terminating the agency removes its platform access
 * while the traveller retains their wallet"). Distinct from
 * `suspendOrganization` in exactly one way that matters: this is
 * permanent -- there is no reactivation path back from CLOSED, matching
 * "termination" rather than a temporary compliance hold. Legal from either
 * ACTIVE or SUSPENDED (an org already suspended for cause can still be
 * terminated outright); never from PENDING_VERIFICATION or REJECTED, since
 * an org that never onboarded has nothing to terminate, and never from an
 * already-CLOSED org (no re-termination).
 *
 * "Removes platform access": `orgGrantPermits` already denies ANY
 * non-ACTIVE status "no standing at all" (the same check `suspendOrganization`
 * already relies on) -- so flipping status to CLOSED is, by itself, the
 * entire access-removal mechanism. Nothing else needs to change for that
 * half of the requirement.
 *
 * "Traveller retains wallet": this function changes the `organizations` row
 * and, under owner decision "Founding A", the agency's own plan (its current
 * subscription ends, its waiting downgrade and that downgrade's queued notice
 * are cancelled; see `endPlanOfClosingAgency`). It never reads or writes
 * `applicants`, `facts`, or `documents` -- traveller-owned tables that were
 * never owned by the organization in the first place, so there is nothing here
 * that could revoke them even by accident.
 *
 * Step-up gated like `suspendOrganization`/`reviewOrganization` -- a
 * permanent, irreversible action deserves at least the same defense-in-depth
 * as a reversible one.
 */
export async function terminateOrganization(
  db: Db,
  input: {
    readonly reviewerAccountId: string;
    readonly organizationId: string;
    readonly stepUpSatisfied: boolean;
  },
): Promise<Result<Organization, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'terminating an organization requires reauthentication'),
    );
  }
  const org = first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));
  if (org.status !== 'ACTIVE' && org.status !== 'SUSPENDED') {
    return err(serviceError('invalid', 'only an ACTIVE or SUSPENDED org can be terminated'));
  }
  return db.transaction(async (tx) => {
    const now = new Date();
    // Only a row still ACTIVE or SUSPENDED is closed: a second termination that read the row
    // before the first one committed changes nothing and records nothing.
    const updated = first(
      await tx
        .update(schema.organizations)
        .set({ status: 'CLOSED', updatedAt: now })
        .where(
          and(
            eq(schema.organizations.id, input.organizationId),
            inArray(schema.organizations.status, ['ACTIVE', 'SUSPENDED']),
          ),
        )
        .returning(),
    );
    if (!updated) {
      return err(serviceError('invalid', 'only an ACTIVE or SUSPENDED org can be terminated'));
    }
    const lockedSubscriptionId = await lockPlanOfClosingAgency(tx, input.organizationId);
    // Owner decision "Founding A": the closed agency's plan stops renewing and ends now; nothing
    // is refunded automatically (endPlanOfClosingAgency below).
    const plan = await endPlanOfClosingAgency(tx, {
      organizationId: input.organizationId,
      actorAccountId: input.reviewerAccountId,
      cause: 'organization_terminated',
      now,
      lockedSubscriptionId,
    });
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_TERMINATED',
      actorAccountId: input.reviewerAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: updated.id,
      metadata: { previousStatus: org.status, subscriptionEnded: plan.ended },
    });
    return ok(updated);
  });
}

/** Add a member to an organization (OWNER/ADMIN only). */
export async function addMembership(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly accountId: string;
    readonly role: MembershipRole;
  },
): Promise<Result<Membership, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can add members'));
  }
  return db.transaction(async (tx) => {
    const seatCheck = await checkSeatEntitlement(tx, input.organizationId);
    if (!seatCheck.ok) return err(seatCheck.error);

    const membership = required(
      first(
        await tx
          .insert(schema.memberships)
          .values({
            accountId: input.accountId,
            organizationId: input.organizationId,
            role: input.role,
          })
          .returning(),
      ),
      'membership',
    );
    await appendAuditEvent(tx, {
      eventType: 'MEMBERSHIP_ADDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'membership',
      resourceId: membership.id,
      metadata: { organizationId: input.organizationId, role: input.role },
    });
    return ok(membership);
  });
}

/**
 * Activate/deactivate a membership (OWNER/ADMIN only). Deactivation ends
 * access immediately.
 *
 * Rebuilt to close a confirmed cross-tenant IDOR
 * (docs/audits/commercial-readiness-recovery-baseline.md §7): the previous
 * version verified the actor's role in `organizationId` but then updated by
 * `membershipId` ALONE, with no clause tying the target row back to that
 * same organization — any org admin (including one who had just
 * self-registered a brand-new organization) could deactivate or reactivate
 * any account's membership in ANY other organization, given only its UUID.
 *
 * Now: the target must be confirmed to belong to `organizationId` before
 * anything happens; only an OWNER may change another OWNER's membership;
 * the last active OWNER can never be deactivated; and the whole
 * precondition-check-then-write sequence is race-safe via row locking
 * (`FOR UPDATE` on every OWNER row of the org before evaluating the
 * last-owner rule), not a plain read-then-write.
 */
export async function setMembershipActive(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly membershipId: string;
    readonly active: boolean;
  },
): Promise<Result<Membership, ServiceError>> {
  const actorMembership = first(
    await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, input.actorAccountId),
          eq(schema.memberships.organizationId, input.organizationId),
        ),
      )
      .limit(1),
  );
  if (
    !actorMembership?.active ||
    (actorMembership.role !== 'OWNER' && actorMembership.role !== 'ADMIN')
  ) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can change memberships'));
  }

  const target = first(
    await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.id, input.membershipId),
          eq(schema.memberships.organizationId, input.organizationId),
        ),
      )
      .limit(1),
  );
  if (!target) {
    return err(serviceError('not_found', 'membership not found in this organization'));
  }
  if (target.role === 'OWNER' && actorMembership.role !== 'OWNER') {
    return err(serviceError('forbidden', "only an OWNER can change another OWNER's membership"));
  }

  return db.transaction(async (tx) => {
    // Re-checked under a shared lock on the organization row: an owner withdrawing the
    // application (which locks that row for update and ends every membership) either finishes
    // first, and this sees the actor's membership ended and the organization CLOSED, or waits.
    const lockedOrg = first(
      await tx
        .select({ status: schema.organizations.status })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, input.organizationId))
        .for('share'),
    );
    if (!lockedOrg) return err(serviceError('not_found', 'organization not found'));
    const lockedActor = first(
      await tx
        .select({ role: schema.memberships.role, active: schema.memberships.active })
        .from(schema.memberships)
        .where(eq(schema.memberships.id, actorMembership.id))
        .limit(1),
    );
    if (!lockedActor?.active || (lockedActor.role !== 'OWNER' && lockedActor.role !== 'ADMIN')) {
      return err(serviceError('forbidden', 'only an org OWNER/ADMIN can change memberships'));
    }
    if (input.active && lockedOrg.status === 'CLOSED') {
      return err(serviceError('invalid', 'a closed organization cannot take members back'));
    }

    // Only a genuine false -> true transition consumes a new seat; a
    // redundant "activate an already-active member" call is a no-op that
    // must never be blocked by a full org.
    if (input.active && !target.active) {
      const seatCheck = await checkSeatEntitlement(tx, input.organizationId);
      if (!seatCheck.ok) return err(seatCheck.error);
    }

    if (!input.active && target.role === 'OWNER') {
      // Lock every OWNER row of this org so a concurrent attempt to
      // deactivate a DIFFERENT owner serializes against this one instead of
      // both independently observing "another owner exists" and both
      // succeeding, leaving zero active owners.
      const owners = await tx
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.organizationId, input.organizationId),
            eq(schema.memberships.role, 'OWNER'),
          ),
        )
        .for('update');
      const otherActiveOwners = owners.filter((o) => o.active && o.id !== input.membershipId);
      if (otherActiveOwners.length === 0) {
        await appendAuditEvent(tx, {
          eventType: 'MEMBERSHIP_CHANGE_DENIED',
          actorAccountId: input.actorAccountId,
          action: 'MANAGE',
          method: 'MANUAL',
          result: 'DENIED',
          resourceType: 'membership',
          resourceId: input.membershipId,
          reason: 'last_active_owner',
        });
        return err(serviceError('invalid', 'cannot deactivate the last active owner'));
      }
    }

    if (!input.active) {
      return endMembershipInTx(tx, {
        actorAccountId: input.actorAccountId,
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        memberAccountId: target.accountId,
        targetRole: target.role,
      });
    }

    const rows = await tx
      .update(schema.memberships)
      .set({ active: true, updatedAt: new Date() })
      .where(
        and(
          eq(schema.memberships.id, input.membershipId),
          eq(schema.memberships.organizationId, input.organizationId),
        ),
      )
      .returning();
    const updated = first(rows);
    if (!updated) {
      return err(serviceError('not_found', 'membership no longer exists in this organization'));
    }
    await appendAuditEvent(tx, {
      eventType: 'MEMBERSHIP_ACTIVATED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'membership',
      resourceId: updated.id,
      metadata: { organizationId: input.organizationId, targetRole: target.role },
    });
    return ok(updated);
  });
}

/**
 * Ends one membership inside the caller's transaction: the single path every deactivation takes
 * (`setMembershipActive`, and an owner withdrawing a pending application). The caller has already
 * decided the change is allowed (role and last-owner rules belong to the caller). It turns the
 * membership off, ends the member's agency AI connections, records MEMBERSHIP_DEACTIVATED and
 * unassigns the member from every open case where they were the only assignee.
 */
async function endMembershipInTx(
  tx: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly membershipId: string;
    readonly memberAccountId: string;
    readonly targetRole: MembershipRole;
  },
): Promise<Result<Membership, ServiceError>> {
  const rows = await tx
    .update(schema.memberships)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.memberships.id, input.membershipId),
        eq(schema.memberships.organizationId, input.organizationId),
      ),
    )
    .returning();
  const updated = first(rows);
  if (!updated) {
    return err(serviceError('not_found', 'membership no longer exists in this organization'));
  }

  // S22: a member turned off can no longer use the agency's AI tools (the AI gate refuses them
  // on the next call); their agency AI connections are also ended, tokens and all. Only after
  // the membership change itself succeeded (round 3), so a membership that vanished ends
  // nothing, and before this transaction's own audit record, so the audit chain is taken last,
  // as in the AI gate.
  await endAgencyAiConnectionsOfMember(tx, {
    organizationId: input.organizationId,
    memberAccountId: input.memberAccountId,
    actorAccountId: input.actorAccountId,
    reason: 'member_removed',
  });

  await appendAuditEvent(tx, {
    eventType: 'MEMBERSHIP_DEACTIVATED',
    actorAccountId: input.actorAccountId,
    action: 'MANAGE',
    method: 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'membership',
    resourceId: updated.id,
    metadata: { organizationId: input.organizationId, targetRole: input.targetRole },
  });

  // Commercial V1 Part 4 §11: "Removed member may not remain sole owner of
  // active case." A deactivated member no longer passes `isActiveMember`,
  // so leaving them as a mission's only assignment would quietly strand
  // that case with an assignee who can no longer act on it. Unassign them
  // from every such mission (active, not CLOSED/CANCELLED) where they were
  // the SOLE assignee -- never where a co-assignee remains, since that
  // case still has a working assignee -- landing each one in the
  // "reassignment queue" (`agency.ts`'s `listUnassignedActiveMissions`)
  // rather than blocking the deactivation itself on a hand-off first.
  const ownMissionAssignments = await tx
    .select({ id: schema.assignments.id, missionId: schema.assignments.missionId })
    .from(schema.assignments)
    .where(
      and(
        eq(schema.assignments.organizationId, input.organizationId),
        eq(schema.assignments.memberAccountId, input.memberAccountId),
      ),
    );
  for (const assignment of ownMissionAssignments) {
    const coAssignees = await tx
      .select({ id: schema.assignments.id })
      .from(schema.assignments)
      .where(
        and(
          eq(schema.assignments.organizationId, input.organizationId),
          eq(schema.assignments.missionId, assignment.missionId),
          ne(schema.assignments.id, assignment.id),
        ),
      )
      .limit(1);
    if (coAssignees.length > 0) continue;
    const mission = first(
      await tx
        .select({ state: schema.missions.state })
        .from(schema.missions)
        .where(eq(schema.missions.id, assignment.missionId))
        .limit(1),
    );
    if (!mission || mission.state === 'CLOSED' || mission.state === 'CANCELLED') continue;
    await tx.delete(schema.assignments).where(eq(schema.assignments.id, assignment.id));
    await appendAuditEvent(tx, {
      eventType: 'MEMBER_UNASSIGNED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: assignment.missionId,
      resourceType: 'assignment',
      resourceId: assignment.id,
      reason: 'sole_assignee_deactivated',
      metadata: { organizationId: input.organizationId, memberAccountId: input.memberAccountId },
    });
  }

  return ok(updated);
}

/**
 * Org OWNER/ADMIN toggles whether `recordMissionDecision` (agency.ts)
 * requires the deciding account to differ from whoever most recently
 * selected the evidence being decided on (Commercial V1 Part 4 §13:
 * "Optional organisation setting: reviewer must differ from preparer. If
 * enabled: server enforces it."). Purely this org's own choice; it never
 * affects any other organization's missions.
 */
export async function setRequireDifferentReviewer(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly required: boolean;
  },
): Promise<Result<Organization, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(
      serviceError('forbidden', "only an org OWNER/ADMIN can change this organization's settings"),
    );
  }
  const updated = required(
    first(
      await db
        .update(schema.organizations)
        .set({ requireDifferentReviewer: input.required, updatedAt: new Date() })
        .where(eq(schema.organizations.id, input.organizationId))
        .returning(),
    ),
    'organization',
  );
  await appendAuditEvent(db, {
    eventType: 'ORGANIZATION_REVIEW_POLICY_CHANGED',
    actorAccountId: input.actorAccountId,
    method: 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'organization',
    resourceId: input.organizationId,
    metadata: { requireDifferentReviewer: input.required },
  });
  return ok(updated);
}

/**
 * The person who applied to register an agency withdraws the application while it is still
 * waiting for review (lifecycle lane G3).
 *
 * Only an active OWNER member may withdraw, and only while the organization is
 * PENDING_VERIFICATION. The organization moves to CLOSED, the status that already means "no
 * standing on the platform": every access check requires ACTIVE, the screens show it as Closed,
 * and the platform review queue offers review only for PENDING_VERIFICATION. A withdrawn
 * application is therefore indistinguishable from a closed agency in status alone; the audit
 * event ORGANIZATION_APPLICATION_WITHDRAWN is what tells them apart.
 *
 * Every membership ends through `endMembershipInTx`, the same path `setMembershipActive` takes,
 * so each carries its own MEMBERSHIP_DEACTIVATED record and its AI connections end. Team
 * invitations that were never used are revoked, because accepting one does not check the
 * organization's status. Client invitations need no change: they already close for any
 * organization that is neither ACTIVE nor PENDING_VERIFICATION.
 *
 * Race safety: the organization row is locked first, so a concurrent withdrawal waits and then
 * sees CLOSED; `reviewOrganization` updates only a row still PENDING_VERIFICATION, so a review
 * that read the row before this commit cannot reopen it; `setMembershipActive` re-checks under a
 * shared lock on the same row, so no member is switched back on afterwards. Audit metadata holds
 * counts only.
 */
export async function withdrawOrganizationApplication(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<Result<Organization, ServiceError>> {
  return db.transaction(async (tx) => {
    const org = first(
      await tx
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, input.organizationId))
        .for('update'),
    );
    if (!org) return err(serviceError('not_found', 'organization not found'));

    const actor = first(
      await tx
        .select({ role: schema.memberships.role, active: schema.memberships.active })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.organizationId, input.organizationId),
            eq(schema.memberships.accountId, input.actorAccountId),
          ),
        )
        .limit(1),
    );
    if (!actor?.active || actor.role !== 'OWNER') {
      return err(serviceError('forbidden', 'only an owner can withdraw this application'));
    }
    if (org.status !== 'PENDING_VERIFICATION') {
      return err(
        serviceError('invalid', 'only an application waiting for review can be withdrawn'),
      );
    }

    // Every agency AI connection of this organization is locked before anything is audited, so
    // this transaction keeps the documented order (connection rows first, the audit chain last)
    // across the whole loop below, not only for its first member.
    if (await agencyAiAvailable(tx)) {
      await tx
        .select({ id: schema.aiConnections.id })
        .from(schema.aiConnectionAgencies)
        .innerJoin(
          schema.aiConnections,
          eq(schema.aiConnections.id, schema.aiConnectionAgencies.connectionId),
        )
        .where(
          and(
            eq(schema.aiConnectionAgencies.organizationId, input.organizationId),
            isNull(schema.aiConnections.revokedAt),
          ),
        )
        .for('update', { of: schema.aiConnections });
    }

    // The agency's plan rows are locked before anything is audited, the same order as above.
    const lockedSubscriptionId = await lockPlanOfClosingAgency(tx, input.organizationId);

    // The row lock above makes the status check final: no other change can land in between.
    const now = new Date();
    const closed = required(
      first(
        await tx
          .update(schema.organizations)
          .set({ status: 'CLOSED', updatedAt: now })
          .where(eq(schema.organizations.id, input.organizationId))
          .returning(),
      ),
      'organization',
    );

    const activeMemberships = await tx
      .select({
        id: schema.memberships.id,
        accountId: schema.memberships.accountId,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.organizationId, input.organizationId),
          eq(schema.memberships.active, true),
        ),
      )
      .for('update');
    let membershipsEnded = 0;
    for (const membership of activeMemberships) {
      const ended = await endMembershipInTx(tx, {
        actorAccountId: input.actorAccountId,
        organizationId: input.organizationId,
        membershipId: membership.id,
        memberAccountId: membership.accountId,
        targetRole: membership.role,
      });
      if (!ended.ok) throw new Error('a locked membership could not be ended');
      membershipsEnded += 1;
    }

    const revoked = await tx
      .update(schema.organizationInvitations)
      .set({ status: 'REVOKED', revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.organizationInvitations.organizationId, input.organizationId),
          eq(schema.organizationInvitations.status, 'PENDING'),
        ),
      )
      .returning({ id: schema.organizationInvitations.id });

    // Owner decision "Founding A": the plan stops renewing and ends with the application; nothing
    // is refunded automatically (endPlanOfClosingAgency below).
    const plan = await endPlanOfClosingAgency(tx, {
      organizationId: input.organizationId,
      actorAccountId: input.actorAccountId,
      cause: 'application_withdrawn',
      now,
      lockedSubscriptionId,
    });

    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_APPLICATION_WITHDRAWN',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: closed.id,
      metadata: {
        membershipsEnded,
        invitationsRevoked: revoked.length,
        subscriptionEnded: plan.ended,
      },
    });
    return ok(closed);
  });
}

/**
 * Owner decision "Founding A" (1 Nov 2026): an agency that withdraws its application or is
 * terminated keeps no plan. Its current subscription ends at the moment the agency closes, so it
 * can never renew: agency invoicing reads only current subscriptions of ACTIVE agencies, and
 * Founding Access is free, so no paid period is left to honour (closing already ends every
 * access). Nothing is refunded here; the owner refunds case by case with the existing refund
 * tool. A scheduled downgrade still waiting is cancelled, so it can never put a plan back on a
 * closed agency.
 *
 * Both helpers are private to this file (they spread to no caller), and run inside the closing
 * transaction after the organization row. `lockPlanOfClosingAgency` audits nothing, so a closing
 * transaction that audits other things first can still take these rows ahead of the audit chain.
 */
type ClosingCause = 'application_withdrawn' | 'organization_terminated';

/**
 * Row locks on the agency's current subscription, then its waiting downgrade (the order every plan
 * change in plans.ts takes them); returns the subscription's id.
 */
async function lockPlanOfClosingAgency(tx: Db, organizationId: string): Promise<string | null> {
  const current = first(
    await tx
      .select({ id: schema.subscriptions.id })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.organizationId, organizationId),
          isNull(schema.subscriptions.endedAt),
        ),
      )
      .for('update'),
  );
  await tx
    .select({ id: schema.scheduledDowngrades.id })
    .from(schema.scheduledDowngrades)
    .where(
      and(
        eq(schema.scheduledDowngrades.organizationId, organizationId),
        eq(schema.scheduledDowngrades.status, 'PENDING'),
      ),
    )
    .for('update');
  return current?.id ?? null;
}

/** Ends the closing agency's plan and its waiting downgrade, audited. A no-op without a plan. */
async function endPlanOfClosingAgency(
  tx: Db,
  input: {
    readonly organizationId: string;
    readonly actorAccountId: string;
    readonly cause: ClosingCause;
    readonly now: Date;
    /** The subscription the caller already locked with `lockPlanOfClosingAgency`. */
    readonly lockedSubscriptionId: string | null;
  },
): Promise<{ readonly ended: boolean }> {
  const subscriptionId = input.lockedSubscriptionId;
  if (subscriptionId === null) return { ended: false };
  const reason =
    input.cause === 'application_withdrawn'
      ? 'the agency withdrew its application'
      : 'the agency was terminated';
  await tx
    .update(schema.subscriptions)
    .set({ endedAt: input.now })
    .where(eq(schema.subscriptions.id, subscriptionId));
  const downgrades = await tx
    .update(schema.scheduledDowngrades)
    .set({
      status: 'CANCELLED',
      cancelledAt: input.now,
      cancelledByAccountId: input.actorAccountId,
      cancelledReason: reason,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(schema.scheduledDowngrades.organizationId, input.organizationId),
        eq(schema.scheduledDowngrades.status, 'PENDING'),
      ),
    )
    .returning({ id: schema.scheduledDowngrades.id });
  for (const downgrade of downgrades) {
    // Its notice still waiting to go out is withdrawn too, as plans.ts does for a superseded one.
    await cancelQueuedNotificationsForResource(tx, downgrade.id);
  }
  for (const downgrade of downgrades) {
    await appendAuditEvent(tx, {
      eventType: 'DOWNGRADE_CANCELLED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'scheduled_downgrade',
      resourceId: downgrade.id,
      reason,
      metadata: { organizationId: input.organizationId },
    });
  }
  await appendAuditEvent(tx, {
    eventType: 'SUBSCRIPTION_ENDED',
    actorAccountId: input.actorAccountId,
    action: 'MANAGE',
    method: 'SYSTEM',
    result: 'ALLOWED',
    resourceType: 'subscription',
    resourceId: subscriptionId,
    reason: input.cause,
    metadata: {
      organizationId: input.organizationId,
      renewalStopped: true,
      refunded: false,
      downgradeCancelled: downgrades.length > 0,
    },
  });
  return { ended: true };
}
