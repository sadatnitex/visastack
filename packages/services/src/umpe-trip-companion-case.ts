/**
 * UMPE UX6 package 4: "Plan My Own Case for This Trip".
 *
 * A joined companion is never a traveller on the organiser's trip (trips are owned by one account
 * and their travellers are that account's own people). What they can do is start their OWN case on
 * their OWN account, with the trip's destination and purpose, through the ordinary case creation
 * path (`createMission`). The case belongs to their own record (their SELF applicant) and appears in
 * their own Home and cases like any other.
 *
 * Nothing flows to the organiser from it. The only link is `own_mission_id` on the companion's own
 * row, which the organiser's list reads for one plain phrase (Getting Ready, Ready to Share ...) and
 * only when the companion chose Plan Status or more (`planPhrases`, which also checks the case
 * belongs to the account that joined). There is no grant, no shared checklist and no access of any
 * kind for the organiser to the case or anything in it.
 *
 * Takes a `TripCompanionAccess`, checked at run time. One case per companion and trip: a second try
 * opens the existing one, and two tries at once cannot make two (the companion's row is locked).
 */
import { type Result, err, ok } from '@visastack/core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  type TripCompanionAccess,
  companionsReady,
  tripCompanionAccessProblem,
} from './access/trip-companion-access';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, schema } from './db';
import { type ServiceError, keyedError } from './errors';
import { lifecycleTablesPresent, presentApplicantCondition } from './lifecycle/foundation';
import { createMission } from './missions';

const TITLE_MAX = 200;

/** What planning a case did. */
export type PlanOwnCaseOutcome =
  | {
      readonly status: 'started' | 'existing';
      readonly missionId: string;
      /** The destination and purpose of the trip, in the trip's own words (for the checklist). */
      readonly destination: string;
      readonly purpose: string;
    }
  /** The account has no record of its own yet: the caller sends them to the first-run steps. */
  | { readonly status: 'needs_own_record' };

/** The companion's own case for this trip, when it is still there (theirs, not removed or purged). */
async function ownCaseOf(db: Db, accountId: string, missionId: string): Promise<string | null> {
  const lifecycle = await lifecycleTablesPresent(db);
  const row = first(
    await db
      .select({ id: schema.missions.id })
      .from(schema.missions)
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
      .where(
        and(
          eq(schema.missions.id, missionId),
          eq(schema.applicants.ownerAccountId, accountId),
          isNull(schema.missions.purgedAt),
          lifecycle ? presentApplicantCondition() : undefined,
        ),
      )
      .limit(1),
  );
  return row?.id ?? null;
}

/**
 * Start the companion's own case for this trip, or open the one they already started. Needs their
 * account consent (as every case does) and a record of their own: when there is none the answer is
 * `needs_own_record`, so the screen can lead them to the first-run steps and back.
 */
export async function planMyOwnCase(
  db: Db,
  access: TripCompanionAccess,
): Promise<Result<PlanOwnCaseOutcome, ServiceError>> {
  const problem = tripCompanionAccessProblem(access, 'JOINED');
  if (problem) return err(problem);
  if (!(await companionsReady(db)))
    return err(
      keyedError('not_found', 'umpe_trip_companion_case.this_invitation_is_not_available'),
    );
  return db.transaction(async (tx) => {
    const companions = schema.umpeTripCompanions;
    // The row is locked, so two tries at once cannot both start a case.
    const row = first(
      await tx
        .select({
          ownMissionId: companions.ownMissionId,
          destination: schema.umpeTrips.destination,
          purpose: schema.umpeTrips.purpose,
        })
        .from(companions)
        .innerJoin(schema.umpeTrips, eq(schema.umpeTrips.id, companions.tripId))
        .where(
          and(
            eq(companions.id, access.companionId),
            eq(companions.tripId, access.tripId),
            eq(companions.state, 'JOINED'),
            eq(companions.joinedAccountId, access.accountId),
          ),
        )
        .limit(1)
        .for('update', { of: companions }),
    );
    if (!row)
      return err(
        keyedError('not_found', 'umpe_trip_companion_case.this_invitation_is_not_available'),
      );
    const { destination, purpose } = row;
    if (row.ownMissionId !== null) {
      const existing = await ownCaseOf(tx, access.accountId, row.ownMissionId);
      if (existing)
        return ok({ status: 'existing' as const, missionId: existing, destination, purpose });
    }
    if (!(await hasConsent(tx, access.accountId, 'CORE_PROCESSING'))) {
      return err(keyedError('consent_required', 'missions.core_processing_consent_is_required'));
    }
    // Their own record: the one that is them, never a family member they manage.
    const lifecycle = await lifecycleTablesPresent(tx);
    const own = first(
      await tx
        .select({ id: schema.applicants.id })
        .from(schema.applicants)
        .where(
          and(
            eq(schema.applicants.ownerAccountId, access.accountId),
            eq(schema.applicants.relationship, 'SELF'),
            lifecycle ? presentApplicantCondition() : undefined,
          ),
        )
        .orderBy(asc(schema.applicants.createdAt), asc(schema.applicants.id))
        .limit(1),
    );
    if (!own) return ok({ status: 'needs_own_record' as const });
    const created = await createMission(tx, {
      actorAccountId: access.accountId,
      applicantId: own.id,
      title: `${destination} - ${purpose}`.slice(0, TITLE_MAX),
      destination,
      purpose,
    });
    if (!created.ok) return created;
    await tx
      .update(companions)
      .set({ ownMissionId: created.value.id, updatedAt: new Date() })
      .where(eq(companions.id, access.companionId));
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_COMPANION_OWN_CASE_STARTED',
      actorAccountId: access.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: own.id,
      missionId: created.value.id,
      resourceType: 'umpe_trip_companion',
      resourceId: access.companionId,
      metadata: { tripId: access.tripId },
    });
    return ok({ status: 'started' as const, missionId: created.value.id, destination, purpose });
  });
}

/**
 * The id of the companion's own case for this trip, or null: the case they started (and still
 * have). Theirs alone; never shown to the organiser.
 */
export async function myTripCaseId(
  db: Db,
  access: TripCompanionAccess,
): Promise<Result<string | null, ServiceError>> {
  const problem = tripCompanionAccessProblem(access, 'JOINED');
  if (problem) return err(problem);
  if (!(await companionsReady(db)))
    return err(
      keyedError('not_found', 'umpe_trip_companion_case.this_invitation_is_not_available'),
    );
  const companions = schema.umpeTripCompanions;
  const row = first(
    await db
      .select({ ownMissionId: companions.ownMissionId })
      .from(companions)
      .where(
        and(
          eq(companions.id, access.companionId),
          eq(companions.tripId, access.tripId),
          eq(companions.state, 'JOINED'),
          eq(companions.joinedAccountId, access.accountId),
        ),
      )
      .limit(1),
  );
  if (!row)
    return err(
      keyedError('not_found', 'umpe_trip_companion_case.this_invitation_is_not_available'),
    );
  return ok(
    row.ownMissionId === null ? null : await ownCaseOf(db, access.accountId, row.ownMissionId),
  );
}
