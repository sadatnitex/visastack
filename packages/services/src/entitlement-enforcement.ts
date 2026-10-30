import { type Result, err, ok } from '@visastack/core';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  isActiveMember,
  listApplicantsForOrganization,
  listOrganizationsWithAccessToApplicant,
} from './agency';
import { type Db, first, schema } from './db';
import { type ResolvedEntitlements, resolveEntitlements } from './entitlements';
import { type ServiceError, refusal } from './errors';
import {
  countActiveSeats,
  countCasesInPeriod,
  countConcurrentOpenCases,
  countPendingInvitations,
} from './plans';
import { recordProductEvent } from './product-events';
import { getOrganizationEvidenceBytes } from './quotas';

/**
 * COM-02: quota/entitlement enforcement (Commercial V1 PRD §12 / master
 * directive Part 5 §7).
 *
 * COM-01 built entitlements as real, queryable, admin-editable data but
 * deliberately enforced nothing ("never make a plan change alter data
 * authorization" -- COM-01 was display-only). This file is that missing
 * enforcement: the exact same entitlement numbers and counting logic
 * `getUsageForOrganization` already displays (`plans.ts`'s
 * `countActiveSeats`/`countCasesInPeriod`/`countConcurrentOpenCases`, now
 * exported and reused here rather than reimplemented, so the number a
 * member sees on the plan page and the number that actually blocks them can
 * never drift apart) are checked BEFORE the action that would consume them,
 * atomically under a per-organization Postgres advisory lock so two
 * concurrent requests can never both squeeze through a single remaining
 * unit.
 *
 * No plan assigned, or a specific entitlement column left NULL on the
 * assigned plan, both mean the same thing everywhere in this file:
 * unlimited, never a block -- exactly COM-01's own already-shipped
 * `UsageMeter.allowed: null` semantics, extended from display into
 * enforcement. This is deliberate and load-bearing: no organization in this
 * system has ever had `activateSubscription` called against it (the
 * function did not exist before COM-01), so treating "no plan" as "zero
 * entitlement" would lock every existing organization out of its own data
 * the instant this shipped. Only an organization actually assigned a plan
 * with a finite number on a given dimension is ever gated on that
 * dimension.
 *
 * Storage is the one dimension enforced by RESOURCE (the applicant being
 * uploaded to), not by a caller-supplied organization id -- `reserveUpload`
 * has no organization in its input at all. `checkStorageEntitlement`
 * derives every organization with current, active, accepted grant access to
 * that applicant (`listOrganizationsWithAccessToApplicant`, agency.ts -- the
 * exact reverse of `listApplicantsForOrganization`, so both directions of
 * "which org sees which applicant" share one definition) and checks each
 * one's own cap independently, since more than one organization can have
 * real, simultaneous, billable access to the same applicant.
 *
 * "Suspended billing blocks new paid work" (PRD COM-02's own line) is now
 * wired too: every check function below refuses outright, independent of
 * any entitlement number, once `isBillingSuspended` (COM-03,
 * `billing.ts`) reads SUSPENDED for the relevant organization -- checked
 * even when no plan is assigned or a dimension is unlimited, since a
 * suspension blocks new capacity regardless of what the plan would
 * otherwise allow. Never touches existing read/export access or
 * already-granted case history, since none of that runs through these
 * four functions in the first place -- they gate only the four
 * capacity-*consuming* actions COM-02 already covered (seats,
 * invitations, case creation, storage), never a read path.
 *
 * A platform-admin "commercial override" (`commercial-override.ts`) is
 * checked first of all, before even billing suspension: an active,
 * unexpired, non-revoked override for the relevant organization makes every
 * check function below return `ok` immediately, bypassing both the
 * suspension check and every capacity number. This is deliberately a blunt,
 * all-four-dimensions bypass -- the directive's own "platform admin; reason;
 * expiry; audit" line names no per-dimension scoping -- and it never
 * touches security, consent, or release-gate code (the directive's "cannot
 * bypass security/consent/release gates"), since nothing outside these four
 * functions ever reads it.
 *
 * Deliberately NOT in this file (see requirements-ledger.md COM-02):
 * - AI allowance enforcement -- the directive's own §7 text defers it ("AI
 *   later"), not a gap this chunk silently left.
 *
 * S29: the order above (override, then a plan that lifts every limit, then
 * suspension, then the plan's numbers) now lives in one place,
 * `resolveEntitlements` (entitlements.ts). Each check below takes its lock
 * first, asks the resolver once, and only then counts; the refusal codes and
 * sentences are S30's, unchanged. Founding Access is no longer recognised by
 * its key: it is the plan's `bypass_limits` flag.
 *
 * S29, owner decision of 30 Oct 2026 (O13): an agency's billing suspension
 * never stops a traveller adding files to their own record. It pauses only
 * the agency's own team (see `checkStorageEntitlement`).
 */

/** Whether the resolver's answer lets the action through without counting anything. */
function unrestricted(resolved: ResolvedEntitlements): boolean {
  return resolved.gate === 'override' || resolved.gate === 'bypass';
}

type PlanLimit = 'SEATS' | 'INVITATIONS' | 'CASES_PER_PERIOD' | 'OPEN_CASES' | 'STORAGE';

/**
 * Refusals are typed (S30, audit M5): `reason` says billing_suspended or limit_reached, and the
 * message is a plain sentence with a next step for the person who sees it. Agency staff are told
 * about their own agency. A traveller adding files to their own record is never told about an
 * agency's billing or plan (that is another party's business): they get one neutral sentence,
 * whichever agency and whichever cause.
 */
export const TRAVELLER_UPLOAD_PAUSED =
  'Adding files to this record is paused right now. Try again later or contact your agency.';

/** For agency staff when their own plan's storage is full: the step that fixes it. */
export const AGENCY_STORAGE_FULL =
  "Your agency's storage is full. Remove files that are no longer needed, or ask VisaStack about a larger plan.";

/** The billing pause for someone working in the agency itself, who is never told to contact it. */
export const AGENCY_UPLOAD_PAUSED =
  'Adding files to this record is paused right now. Try again later.';

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * What a person accepting an invitation is told when the agency has no room or its billing is
 * paused: never the agency's billing, invoices or members, only the next step.
 */
export const INVITEE_CANNOT_JOIN =
  'This agency cannot add new team members right now. Ask the person who invited you to contact VisaStack.';

/**
 * Refuses with `error` and records, for OPS-04's plan-usage learning, that this
 * organization ran into this limit. At most one event per organization, limit
 * and day: the signal is "which organizations are hitting which caps", not how
 * many times someone clicked after being told no. The caller's own refusal
 * path commits the event with the rest of its (empty) transaction, and a
 * failure to record never changes the refusal.
 */
async function limitReached(
  tx: Db,
  organizationId: string,
  limit: PlanLimit,
  error: ServiceError,
): Promise<Result<void, ServiceError>> {
  await recordProductEvent(tx, {
    eventType: 'PLAN_LIMIT_REACHED',
    accountId: null,
    organizationId,
    dimension: limit,
    onceFor: `${organizationId}:${limit}:${new Date().toISOString().slice(0, 10)}`,
  });
  return err(error);
}

// Two-argument advisory-lock namespaces (the high bits of the composite
// `pg_advisory_xact_lock(int, int)` key), matching `db.ts`'s
// `EMAIL_LOCK_NAMESPACE` pattern: each namespace is a distinct, non-zero
// integer, keeping this lock space disjoint from every other namespaced or
// single-bigint `pg_advisory_xact_lock` key already in use elsewhere
// (`db.ts`'s email lock, `audit.ts`'s chain lock, `platform-roles.ts`'s
// grant lock, `uploads.ts`'s/`ai.ts`'s hashtext-derived locks).
const SEAT_QUOTA_LOCK_NAMESPACE = 550_100_1;
const CASE_QUOTA_LOCK_NAMESPACE = 550_100_2;

/**
 * Refuses if activating one more seat would exceed the organization's
 * current plan's `seatsAllowed`. Call this INSIDE the same transaction that
 * will insert or reactivate the membership row, as the first statement, so
 * the advisory lock it takes covers the count-then-write sequence -- not
 * merely a read. The caller decides whether a check even applies (skip it
 * for a no-op re-confirmation of an already-active membership, which
 * consumes no new seat).
 */
export async function checkSeatEntitlement(
  tx: Db,
  organizationId: string,
): Promise<Result<void, ServiceError>> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${SEAT_QUOTA_LOCK_NAMESPACE}, hashtext(${organizationId}))`,
  );
  const resolved = await resolveEntitlements(tx, { organizationId });
  if (unrestricted(resolved)) return ok(undefined);
  if (resolved.gate === 'suspended') {
    return err(
      refusal(
        'billing_suspended',
        "Your agency's billing is paused, so adding team members is paused too. Pay the open invoice to continue.",
      ),
    );
  }
  const allowed = resolved.limits.seats;
  if (allowed === null) return ok(undefined);
  const current = await countActiveSeats(tx, organizationId);
  if (current >= allowed) {
    return limitReached(
      tx,
      organizationId,
      'SEATS',
      refusal(
        'limit_reached',
        `Your agency's plan allows ${count(allowed, 'team member')}, and that many are active. Remove someone who no longer needs access, or ask VisaStack about a larger plan.`,
      ),
    );
  }
  return ok(undefined);
}

/**
 * Refuses to mint a new invitation if active seats plus already-pending
 * invitations have already reached the plan's `seatsAllowed` -- the
 * directive's own separate "invitations where plan constrained" line,
 * distinct from seat *activation*: without this, an org could send far more
 * invitations than it has room for, each one only failing -- confusingly,
 * possibly days later -- at acceptance. Shares `checkSeatEntitlement`'s exact
 * lock key so a concurrent invite-send and invite-accept for the same org
 * correctly serialize against each other too.
 */
export async function checkInvitationEntitlement(
  tx: Db,
  organizationId: string,
): Promise<Result<void, ServiceError>> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${SEAT_QUOTA_LOCK_NAMESPACE}, hashtext(${organizationId}))`,
  );
  const resolved = await resolveEntitlements(tx, { organizationId });
  if (unrestricted(resolved)) return ok(undefined);
  if (resolved.gate === 'suspended') {
    return err(
      refusal(
        'billing_suspended',
        "Your agency's billing is paused, so inviting team members is paused too. Pay the open invoice to continue.",
      ),
    );
  }
  const allowed = resolved.limits.invitations;
  if (allowed === null) return ok(undefined);
  const activeSeats = await countActiveSeats(tx, organizationId);
  const pending = await countPendingInvitations(tx, organizationId);
  if (activeSeats + pending >= allowed) {
    return limitReached(
      tx,
      organizationId,
      'INVITATIONS',
      refusal(
        'limit_reached',
        `Your agency's plan allows ${count(allowed, 'team member')}, and active members and open invitations already fill it. Cancel an invitation, remove someone who no longer needs access, or ask VisaStack about a larger plan.`,
      ),
    );
  }
  return ok(undefined);
}

/**
 * Refuses a new case (mission) attributed to this organization
 * (`ownerOrganizationId`) if it would exceed either `casesPerPeriodAllowed`
 * (a trailing `periodDays`-day window, matching `getUsageForOrganization`'s
 * own window exactly) or `concurrentOpenCasesAllowed`. Call this INSIDE
 * `createMission`'s transaction, as the first statement, only when
 * `ownerOrganizationId` is present -- an individual traveller's own case has
 * no organization to check a cap against.
 */
export async function checkCaseCreationEntitlement(
  tx: Db,
  organizationId: string,
): Promise<Result<void, ServiceError>> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${CASE_QUOTA_LOCK_NAMESPACE}, hashtext(${organizationId}))`,
  );
  const resolved = await resolveEntitlements(tx, { organizationId });
  if (unrestricted(resolved)) return ok(undefined);
  if (resolved.gate === 'suspended') {
    return err(
      refusal(
        'billing_suspended',
        "Your agency's billing is paused, so starting new cases is paused too. An owner or admin can pay the open invoice to continue.",
      ),
    );
  }
  const plan = resolved.plan;
  if (!plan) return ok(undefined);

  const casesAllowed = resolved.limits.cases_per_period;
  if (casesAllowed !== null) {
    const periodStart = new Date(Date.now() - plan.periodDays * 24 * 60 * 60 * 1000);
    const casesThisPeriod = await countCasesInPeriod(tx, organizationId, periodStart);
    if (casesThisPeriod >= casesAllowed) {
      return limitReached(
        tx,
        organizationId,
        'CASES_PER_PERIOD',
        refusal(
          'limit_reached',
          `Your agency's plan allows ${count(casesAllowed, 'new case')} every ${plan.periodDays} days, and they are used. You can start more when the period moves on, or ask VisaStack about a larger plan.`,
        ),
      );
    }
  }

  const openAllowed = resolved.limits.open_cases;
  if (openAllowed !== null) {
    const concurrentOpen = await countConcurrentOpenCases(tx, organizationId);
    if (concurrentOpen >= openAllowed) {
      return limitReached(
        tx,
        organizationId,
        'OPEN_CASES',
        refusal(
          'limit_reached',
          `Your agency's plan allows ${count(openAllowed, 'open case')} at a time, and that many are open. Close a finished case, or ask VisaStack about a larger plan.`,
        ),
      );
    }
  }

  return ok(undefined);
}

/** Sum of currently-RESERVED, unexpired upload bytes across every applicant this organization has current grant access to -- the in-flight half of its storage entitlement, mirroring `uploads.ts`'s own `activeReservedBytesFor` shape but keyed by an organization's whole applicant set rather than a single id. */
async function activeReservedBytesForOrganization(tx: Db, organizationId: string): Promise<number> {
  const applicants = await listApplicantsForOrganization(tx, organizationId);
  if (applicants.length === 0) return 0;
  const row = first(
    await tx
      .select({ total: sql<string>`coalesce(sum(${schema.uploadIntents.reservedBytes}), 0)` })
      .from(schema.uploadIntents)
      .where(
        and(
          inArray(
            schema.uploadIntents.applicantId,
            applicants.map((a) => a.applicantId),
          ),
          eq(schema.uploadIntents.status, 'RESERVED'),
          gt(schema.uploadIntents.expiresAt, sql`now()`),
        ),
      ),
  );
  return Number(row?.total ?? 0);
}

/**
 * Refuses if reserving `additionalBytes` for this applicant would exceed
 * ANY organization's `storageBytesAllowed`, checked independently across
 * every organization with current grant access to this applicant. Call this
 * from INSIDE `reserveUpload`'s already-locked transaction -- its existing
 * `'visastack:upload-quota'` platform-wide lock already serializes every
 * reservation attempt, so no separate lock is needed here.
 */
export async function checkStorageEntitlement(
  tx: Db,
  applicantId: string,
  additionalBytes: number,
  uploaderAccountId?: string,
): Promise<Result<void, ServiceError>> {
  const organizationIds = await listOrganizationsWithAccessToApplicant(tx, applicantId);
  // The neutral sentence, chosen by who is adding the file: a member of the refusing agency is
  // not told to contact their own agency (S30).
  const inAgency = async (organizationId: string) =>
    uploaderAccountId !== undefined &&
    (await isActiveMember(tx, uploaderAccountId, organizationId));
  // A full plan is the agency's own to fix: its staff get the next step (S30).
  const full = async (organizationId: string) =>
    (await inAgency(organizationId)) ? AGENCY_STORAGE_FULL : TRAVELLER_UPLOAD_PAUSED;
  // S29 round 2: a person adding files to their own record is never stopped by any agency's
  // suspension, even when they also work in that agency.
  const ownRecord =
    uploaderAccountId !== undefined &&
    (
      await tx
        .select({ owner: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, applicantId))
        .limit(1)
    )[0]?.owner === uploaderAccountId;
  for (const organizationId of organizationIds) {
    const resolved = await resolveEntitlements(tx, { organizationId });
    if (unrestricted(resolved)) continue;
    // Owner decision O13 (30 Oct 2026): a suspension pauses only the agency's own team. A
    // traveller (or another agency's staff) adding files is never stopped by it.
    if (resolved.gate === 'suspended' && !ownRecord && (await inAgency(organizationId))) {
      return err(refusal('billing_suspended', AGENCY_UPLOAD_PAUSED));
    }
    const allowed = resolved.limits.storage_bytes;
    if (allowed === null) continue;
    const committed = await getOrganizationEvidenceBytes(tx, organizationId);
    const reserved = await activeReservedBytesForOrganization(tx, organizationId);
    if (committed + reserved + additionalBytes > allowed) {
      return limitReached(
        tx,
        organizationId,
        'STORAGE',
        refusal('limit_reached', await full(organizationId)),
      );
    }
  }
  return ok(undefined);
}
