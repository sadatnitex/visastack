import type { MembershipRole } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, ne } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { checkSeatEntitlement } from './entitlement-enforcement';
import { type ServiceError, serviceError } from './errors';

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

/** Every organization (platform-admin overview), newest first. */
export async function listAllOrganizations(db: Db): Promise<Organization[]> {
  const rows = await db.select().from(schema.organizations);
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
    return err(serviceError('invalid', 'only a PENDING_VERIFICATION org can be reviewed'));
  }
  if (await isMember(db, input.reviewerAccountId, input.organizationId)) {
    return err(serviceError('forbidden', 'an organization cannot verify itself'));
  }
  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.organizations)
          .set({ status: input.decision, updatedAt: new Date() })
          .where(eq(schema.organizations.id, input.organizationId))
          .returning(),
      ),
      'organization',
    );
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
 * "Traveller retains wallet": this function touches only the `organizations`
 * row. It never reads or writes `applicants`, `facts`, or `documents` --
 * traveller-owned tables that were never owned by the organization in the
 * first place, so there is nothing here that could revoke them even by
 * accident.
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
    const updated = required(
      first(
        await tx
          .update(schema.organizations)
          .set({ status: 'CLOSED', updatedAt: new Date() })
          .where(eq(schema.organizations.id, input.organizationId))
          .returning(),
      ),
      'organization',
    );
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_TERMINATED',
      actorAccountId: input.reviewerAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: updated.id,
      metadata: { previousStatus: org.status },
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

    const rows = await tx
      .update(schema.memberships)
      .set({ active: input.active, updatedAt: new Date() })
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
      eventType: input.active ? 'MEMBERSHIP_ACTIVATED' : 'MEMBERSHIP_DEACTIVATED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'membership',
      resourceId: updated.id,
      metadata: { organizationId: input.organizationId, targetRole: target.role },
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
    if (!input.active) {
      const ownMissionAssignments = await tx
        .select({ id: schema.assignments.id, missionId: schema.assignments.missionId })
        .from(schema.assignments)
        .where(
          and(
            eq(schema.assignments.organizationId, input.organizationId),
            eq(schema.assignments.memberAccountId, target.accountId),
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
          metadata: { organizationId: input.organizationId, memberAccountId: target.accountId },
        });
      }
    }

    return ok(updated);
  });
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
