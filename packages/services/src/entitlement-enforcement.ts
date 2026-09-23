import { type Result, err, ok } from '@visastack/core';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { listApplicantsForOrganization, listOrganizationsWithAccessToApplicant } from './agency';
import { isBillingSuspended } from './billing';
import { isCommercialOverrideActive } from './commercial-override';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  countActiveSeats,
  countCasesInPeriod,
  countConcurrentOpenCases,
  getCurrentPlanForOrganization,
} from './plans';
import { getOrganizationEvidenceBytes, mbLabel } from './quotas';

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
 */

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
  if (await isCommercialOverrideActive(tx, organizationId)) return ok(undefined);
  if (await isBillingSuspended(tx, organizationId)) {
    return err(
      serviceError(
        'invalid',
        'billing for this organization is suspended; new seats cannot be added until it is resolved',
      ),
    );
  }
  const plan = await getCurrentPlanForOrganization(tx, organizationId);
  if (!plan || plan.seatsAllowed === null) return ok(undefined);
  const current = await countActiveSeats(tx, organizationId);
  if (current >= plan.seatsAllowed) {
    return err(
      serviceError(
        'invalid',
        `this organization's plan allows ${plan.seatsAllowed} active seat${plan.seatsAllowed === 1 ? '' : 's'}, and that limit is already reached`,
      ),
    );
  }
  return ok(undefined);
}

async function countPendingInvitations(tx: Db, organizationId: string): Promise<number> {
  const row = first(
    await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.organizationInvitations)
      .where(
        and(
          eq(schema.organizationInvitations.organizationId, organizationId),
          eq(schema.organizationInvitations.status, 'PENDING'),
        ),
      ),
  );
  return row?.n ?? 0;
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
  if (await isCommercialOverrideActive(tx, organizationId)) return ok(undefined);
  if (await isBillingSuspended(tx, organizationId)) {
    return err(
      serviceError(
        'invalid',
        'billing for this organization is suspended; new invitations cannot be sent until it is resolved',
      ),
    );
  }
  const plan = await getCurrentPlanForOrganization(tx, organizationId);
  if (!plan || plan.seatsAllowed === null) return ok(undefined);
  const activeSeats = await countActiveSeats(tx, organizationId);
  const pending = await countPendingInvitations(tx, organizationId);
  if (activeSeats + pending >= plan.seatsAllowed) {
    return err(
      serviceError(
        'invalid',
        `this organization's plan allows ${plan.seatsAllowed} active seat${plan.seatsAllowed === 1 ? '' : 's'}; active members plus pending invitations have already reached that limit`,
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
  if (await isCommercialOverrideActive(tx, organizationId)) return ok(undefined);
  if (await isBillingSuspended(tx, organizationId)) {
    return err(
      serviceError(
        'invalid',
        'billing for this organization is suspended; new cases cannot be created until it is resolved',
      ),
    );
  }
  const plan = await getCurrentPlanForOrganization(tx, organizationId);
  if (!plan) return ok(undefined);

  if (plan.casesPerPeriodAllowed !== null) {
    const periodStart = new Date(Date.now() - plan.periodDays * 24 * 60 * 60 * 1000);
    const casesThisPeriod = await countCasesInPeriod(tx, organizationId, periodStart);
    if (casesThisPeriod >= plan.casesPerPeriodAllowed) {
      return err(
        serviceError(
          'invalid',
          `this organization's plan allows ${plan.casesPerPeriodAllowed} new case${plan.casesPerPeriodAllowed === 1 ? '' : 's'} per ${plan.periodDays}-day period, and that limit is already reached`,
        ),
      );
    }
  }

  if (plan.concurrentOpenCasesAllowed !== null) {
    const concurrentOpen = await countConcurrentOpenCases(tx, organizationId);
    if (concurrentOpen >= plan.concurrentOpenCasesAllowed) {
      return err(
        serviceError(
          'invalid',
          `this organization's plan allows ${plan.concurrentOpenCasesAllowed} concurrent open case${plan.concurrentOpenCasesAllowed === 1 ? '' : 's'}, and that limit is already reached`,
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
): Promise<Result<void, ServiceError>> {
  const organizationIds = await listOrganizationsWithAccessToApplicant(tx, applicantId);
  for (const organizationId of organizationIds) {
    if (await isCommercialOverrideActive(tx, organizationId)) continue;
    if (await isBillingSuspended(tx, organizationId)) {
      return err(
        serviceError(
          'invalid',
          'an organization with access to this applicant has suspended billing; new uploads cannot be added until it is resolved',
        ),
      );
    }
    const plan = await getCurrentPlanForOrganization(tx, organizationId);
    if (!plan || plan.storageBytesAllowed === null) continue;
    const committed = await getOrganizationEvidenceBytes(tx, organizationId);
    const reserved = await activeReservedBytesForOrganization(tx, organizationId);
    if (committed + reserved + additionalBytes > plan.storageBytesAllowed) {
      return err(
        serviceError(
          'invalid',
          `an organization with access to this applicant has reached its ${mbLabel(plan.storageBytesAllowed)} plan storage limit`,
        ),
      );
    }
  }
  return ok(undefined);
}
