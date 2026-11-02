/**
 * UMPE P5 (R20, R21): group trips and family packages.
 *
 * One trip is the account holder's shared travel intention ("Who's Travelling?"). It composes the
 * ordinary cases of the travellers that account manages, one case per traveller, opened or started
 * through P4's `openOrStartTripCase`. It is never a merged person record: each traveller keeps their
 * own case, checklist, documents, facts and permissions, and their checklist is worked out from
 * their own answers (nationality, residence, age, funding).
 *
 * Access. Every export takes a genuine owner proof (`requireAccess`, actor `applicant_owner`): the
 * signed-in account owns that traveller. A trip is only ever found by its id AND that owner account,
 * so another account's trip looks exactly like a missing one. Adding a traveller takes that
 * traveller's own MANAGE proof, so an adult outside the account (a grant recipient, or anyone else)
 * is refused and nothing of theirs is read or written. A family member or child record also needs
 * the account holder's recorded authority (`travellerAuthorityProblem`).
 *
 * Common evidence (a shared booking or itinerary) is a reference to one traveller's own document,
 * never a copy. It is referenced for another traveller only after an explicit allowance made with
 * that traveller's proof; nothing is shared between travellers automatically. Removing a traveller
 * ends their link and every allowance to or from them, and keeps their case.
 *
 * Every mutation is audited with ids, counts and kinds only. Until the migration runs the tables
 * are missing: readers answer "no trips" and writers refuse plainly.
 */
import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  lifecycleTablesPresent,
  presentApplicantCondition,
  presentDocumentCondition,
} from './lifecycle/foundation';
import { openOrStartTripCase } from './umpe-package-start';
import {
  TRIP_MAX_TRAVELLERS,
  type TravellerAuthorityProblem,
  type TripRelationship,
  isCommonTripEvidenceType,
  travellerAuthorityProblem,
} from './umpe-trip-rules';
import { tripTablesPresent } from './umpe-trip-tables';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 120;
const TITLE_MAX = 200;
const LIST_LIMIT = 50;

const TRIP_NOT_AVAILABLE = 'That trip is not available.';
const NOT_SWITCHED_ON = 'Group trips are not switched on yet. Start each case on its own for now.';
const OWNER_ONLY = 'Only the account holder who manages this traveller can do this.';

const AUTHORITY_WORDS: Readonly<Record<TravellerAuthorityProblem, string>> = {
  AUTHORITY_NOT_CONFIRMED:
    'Confirm on their profile that you may act for this traveller before adding them to a trip.',
  GUARDIAN_NOT_CONFIRMED:
    'Confirm on their profile that you are the parent or guardian of this child before adding them to a trip.',
};

export interface TripIntentionInput {
  readonly destination: string;
  readonly purpose: string;
  /** Optional trip name; by default "<destination> - <purpose>". */
  readonly title?: string;
}

export interface TripSummary {
  readonly id: string;
  readonly title: string;
  readonly destination: string;
  readonly purpose: string;
  readonly travellerCount: number;
  readonly createdAt: string;
}

export interface TripTravellerView {
  readonly applicantId: string;
  readonly missionId: string;
  readonly name: string;
  readonly relationship: TripRelationship;
  readonly caseTitle: string;
  readonly caseState: string;
  readonly addedAt: string;
}

export interface TripView {
  readonly id: string;
  readonly title: string;
  readonly destination: string;
  readonly purpose: string;
  readonly itineraryRef: string;
  readonly createdAt: string;
  readonly travellers: readonly TripTravellerView[];
}

export interface TripEvidenceView {
  readonly id: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly docType: string | null;
  readonly sourceApplicantId: string;
  /** The travellers the owner allowed this document for (never the source traveller). */
  readonly allowedFor: readonly string[];
}

export interface TravellerTripEvidenceView {
  readonly id: string;
  readonly documentName: string;
  readonly docType: string | null;
  /** True when it is the traveller's own document; false when it was allowed for them. */
  readonly own: boolean;
}

export interface AddTravellerOutcome {
  readonly missionId: string;
  /** True when the traveller's existing active case for this trip was used. */
  readonly existingCase: boolean;
  /** True when the traveller was already on the trip (nothing changed). */
  readonly alreadyOnTrip: boolean;
  /** The trip's own destination and purpose, as the traveller's case was opened with them. */
  readonly destination: string;
  readonly purpose: string;
}

type Trip = typeof schema.umpeTrips.$inferSelect;

// --- Proof checks -----------------------------------------------------------------------------

/**
 * The account holder behind a genuine owner proof, or a refusal. A proof issued to anyone else (a
 * grant recipient, an agency member, support) never reaches a trip.
 */
function ownerAccountOf<A extends 'VIEW_METADATA' | 'MANAGE'>(
  proof: AuthorizedApplicant<A>,
  action: A,
): Result<string, ServiceError> {
  if (!AuthorizedApplicant.isGenuine(proof, action) || proof.actor.kind !== 'applicant_owner') {
    return err(serviceError('forbidden', OWNER_ONLY));
  }
  return ok(proof.applicant.ownerAccountId);
}

/** An owner proof about the traveller record itself (not one of their cases or documents). */
function travellerProof<A extends 'VIEW_METADATA' | 'MANAGE'>(
  proof: AuthorizedApplicant<A>,
  action: A,
): Result<string, ServiceError> {
  const owner = ownerAccountOf(proof, action);
  if (!owner.ok) return owner;
  if (proof.resource.kind !== 'applicant' || proof.resource.applicantId !== proof.applicant.id) {
    return err(serviceError('invalid', 'Choose the traveller, not one of their cases.'));
  }
  return owner;
}

/** The trip, only when it belongs to `ownerAccountId`; a denied trip looks missing. */
async function ownedTrip(
  db: Db,
  ownerAccountId: string,
  tripId: string,
): Promise<Result<Trip, ServiceError>> {
  if (!UUID.test(tripId)) return err(serviceError('not_found', TRIP_NOT_AVAILABLE));
  const trip = first(
    await db
      .select()
      .from(schema.umpeTrips)
      .where(
        and(eq(schema.umpeTrips.id, tripId), eq(schema.umpeTrips.ownerAccountId, ownerAccountId)),
      )
      .limit(1),
  );
  return trip ? ok(trip) : err(serviceError('not_found', TRIP_NOT_AVAILABLE));
}

async function liveTraveller(db: Db, tripId: string, applicantId: string) {
  return first(
    await db
      .select({ id: schema.umpeTripTravellers.id, missionId: schema.umpeTripTravellers.missionId })
      .from(schema.umpeTripTravellers)
      .where(
        and(
          eq(schema.umpeTripTravellers.tripId, tripId),
          eq(schema.umpeTripTravellers.applicantId, applicantId),
          isNull(schema.umpeTripTravellers.removedAt),
        ),
      )
      .limit(1),
  );
}

async function liveTravellerCount(db: Db, tripId: string): Promise<number> {
  const row = first(
    await db
      .select({ n: count() })
      .from(schema.umpeTripTravellers)
      .where(
        and(
          eq(schema.umpeTripTravellers.tripId, tripId),
          isNull(schema.umpeTripTravellers.removedAt),
        ),
      ),
  );
  return Number(row?.n ?? 0);
}

function cleanIntention(
  input: TripIntentionInput,
): Result<{ destination: string; purpose: string; title: string }, ServiceError> {
  const destination = input.destination.trim();
  const purpose = input.purpose.trim();
  if (destination.length === 0 || destination.length > NAME_MAX) {
    return err(serviceError('invalid', 'Choose where you are going.'));
  }
  if (purpose.length === 0 || purpose.length > NAME_MAX) {
    return err(serviceError('invalid', 'Choose why you are travelling.'));
  }
  const title = (input.title?.trim() || `${destination} - ${purpose}`).slice(0, TITLE_MAX);
  return ok({ destination, purpose, title });
}

/** A label unique to this trip, written into a traveller's case only when the case has none. */
function itineraryLabel(title: string, tripId: string): string {
  const suffix = ` - Trip ${tripId.slice(0, 8).toUpperCase()}`;
  return `${title.slice(0, TITLE_MAX - suffix.length)}${suffix}`;
}

/**
 * Open or start the traveller's own case for this trip and link it, inside one audited
 * transaction for the link. The case itself is created by P4's start (which checks ownership,
 * consent and the case name); the link never edits anything of the traveller's but an empty
 * itinerary label.
 */
async function linkTraveller(
  proof: AuthorizedApplicant<'MANAGE'>,
  trip: Trip,
): Promise<Result<AddTravellerOutcome, ServiceError>> {
  const problem = travellerAuthorityProblem(proof.applicant);
  if (problem) return err(serviceError('forbidden', AUTHORITY_WORDS[problem]));
  const already = await liveTraveller(proof.tx, trip.id, proof.applicant.id);
  if (already) {
    return ok({
      missionId: already.missionId,
      existingCase: true,
      alreadyOnTrip: true,
      destination: trip.destination,
      purpose: trip.purpose,
    });
  }
  if ((await liveTravellerCount(proof.tx, trip.id)) >= TRIP_MAX_TRAVELLERS) {
    return err(serviceError('invalid', `A trip holds up to ${TRIP_MAX_TRAVELLERS} travellers.`));
  }
  const opened = await openOrStartTripCase(proof, {
    destination: trip.destination,
    purpose: trip.purpose,
  });
  if (!opened.ok) return opened;
  const ownerAccountId = proof.applicant.ownerAccountId;
  return proof.tx.transaction(async (tx) => {
    // A second request racing this one may have linked the traveller first: keep one live link.
    const inserted = await tx
      .insert(schema.umpeTripTravellers)
      .values({
        tripId: trip.id,
        applicantId: proof.applicant.id,
        missionId: opened.value.missionId,
        addedByAccountId: ownerAccountId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.umpeTripTravellers.id });
    if (inserted.length === 0) {
      return ok({
        missionId: opened.value.missionId,
        existingCase: opened.value.existing,
        alreadyOnTrip: true,
        destination: trip.destination,
        purpose: trip.purpose,
      });
    }
    // The existing "Family Trip Label" keeps working: an empty label is filled, a chosen one kept.
    const labelled = await tx
      .update(schema.missions)
      .set({ itineraryRef: trip.itineraryRef, updatedAt: new Date() })
      .where(
        and(
          eq(schema.missions.id, opened.value.missionId),
          eq(schema.missions.applicantId, proof.applicant.id),
          isNull(schema.missions.itineraryRef),
        ),
      )
      .returning({ id: schema.missions.id });
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_TRAVELLER_ADDED',
      actorAccountId: ownerAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proof.applicant.id,
      missionId: opened.value.missionId,
      resourceType: 'umpe_trip',
      resourceId: trip.id,
      metadata: {
        relationship: proof.applicant.relationship,
        existingCase: opened.value.existing,
        labelled: labelled.length,
      },
    });
    return ok({
      missionId: opened.value.missionId,
      existingCase: opened.value.existing,
      alreadyOnTrip: false,
      destination: trip.destination,
      purpose: trip.purpose,
    });
  });
}

// --- Public API -------------------------------------------------------------------------------

/**
 * Start a group trip with its first traveller (the one this MANAGE proof is for). The traveller's
 * case is opened or started first, so a refusal there (consent, authority) leaves no empty trip.
 */
export async function startGroupTrip(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: TripIntentionInput,
): Promise<Result<{ readonly tripId: string } & AddTravellerOutcome, ServiceError>> {
  const owner = travellerProof(proof, 'MANAGE');
  if (!owner.ok) return owner;
  if (!(await tripTablesPresent(proof.tx))) return err(serviceError('invalid', NOT_SWITCHED_ON));
  const intention = cleanIntention(input);
  if (!intention.ok) return intention;
  const problem = travellerAuthorityProblem(proof.applicant);
  if (problem) return err(serviceError('forbidden', AUTHORITY_WORDS[problem]));
  const tripId = randomUUID();
  const trip = await proof.tx.transaction(async (tx) => {
    const row = first(
      await tx
        .insert(schema.umpeTrips)
        .values({
          id: tripId,
          ownerAccountId: owner.value,
          title: intention.value.title,
          destination: intention.value.destination,
          purpose: intention.value.purpose,
          itineraryRef: itineraryLabel(intention.value.title, tripId),
        })
        .returning(),
    );
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_STARTED',
      actorAccountId: owner.value,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'umpe_trip',
      resourceId: tripId,
      metadata: { travellers: 1 },
    });
    return row;
  });
  if (!trip) return err(serviceError('invalid', 'The trip could not be started. Try again.'));
  const linked = await linkTraveller(proof, trip);
  if (!linked.ok) {
    // Nothing of the traveller's was linked: remove the empty trip again so none is left behind.
    await proof.tx
      .delete(schema.umpeTrips)
      .where(
        and(eq(schema.umpeTrips.id, trip.id), eq(schema.umpeTrips.ownerAccountId, owner.value)),
      );
    return linked;
  }
  return ok({ tripId: trip.id, ...linked.value });
}

/**
 * Add Travellers: link one more traveller the account holder manages (their own MANAGE proof),
 * opening their existing active case for this destination and purpose or starting one.
 */
export async function addTravellerToTrip(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
): Promise<Result<AddTravellerOutcome, ServiceError>> {
  const owner = travellerProof(proof, 'MANAGE');
  if (!owner.ok) return owner;
  if (!(await tripTablesPresent(proof.tx))) return err(serviceError('invalid', NOT_SWITCHED_ON));
  const trip = await ownedTrip(proof.tx, owner.value, tripId);
  if (!trip.ok) return trip;
  return linkTraveller(proof, trip.value);
}

/**
 * Remove a traveller from the trip. Their case, documents and package stay exactly as they are
 * (only the trip's own label is taken off the case, if it is still there); every common document
 * allowed for them, and every one they brought, stops being referenced.
 */
export async function removeTravellerFromTrip(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
): Promise<Result<{ readonly removed: boolean }, ServiceError>> {
  const owner = travellerProof(proof, 'MANAGE');
  if (!owner.ok) return owner;
  if (!(await tripTablesPresent(proof.tx))) return err(serviceError('invalid', NOT_SWITCHED_ON));
  const trip = await ownedTrip(proof.tx, owner.value, tripId);
  if (!trip.ok) return trip;
  const applicantId = proof.applicant.id;
  return proof.tx.transaction(async (tx) => {
    const now = new Date();
    const ended = await tx
      .update(schema.umpeTripTravellers)
      .set({ removedAt: now })
      .where(
        and(
          eq(schema.umpeTripTravellers.tripId, trip.value.id),
          eq(schema.umpeTripTravellers.applicantId, applicantId),
          isNull(schema.umpeTripTravellers.removedAt),
        ),
      )
      .returning({ missionId: schema.umpeTripTravellers.missionId });
    if (ended.length === 0) return ok({ removed: false });
    const evidenceIds = (
      await tx
        .select({ id: schema.umpeTripEvidence.id })
        .from(schema.umpeTripEvidence)
        .where(eq(schema.umpeTripEvidence.tripId, trip.value.id))
    ).map((r) => r.id);
    const revoked =
      evidenceIds.length === 0
        ? []
        : await tx
            .update(schema.umpeTripEvidenceAllowances)
            .set({ revokedAt: now })
            .where(
              and(
                inArray(schema.umpeTripEvidenceAllowances.tripEvidenceId, evidenceIds),
                eq(schema.umpeTripEvidenceAllowances.applicantId, applicantId),
                isNull(schema.umpeTripEvidenceAllowances.revokedAt),
              ),
            )
            .returning({ id: schema.umpeTripEvidenceAllowances.id });
    const withdrawn = await tx
      .update(schema.umpeTripEvidence)
      .set({ removedAt: now })
      .where(
        and(
          eq(schema.umpeTripEvidence.tripId, trip.value.id),
          eq(schema.umpeTripEvidence.sourceApplicantId, applicantId),
          isNull(schema.umpeTripEvidence.removedAt),
        ),
      )
      .returning({ id: schema.umpeTripEvidence.id });
    const ownRevoked =
      withdrawn.length === 0
        ? []
        : await tx
            .update(schema.umpeTripEvidenceAllowances)
            .set({ revokedAt: now })
            .where(
              and(
                inArray(
                  schema.umpeTripEvidenceAllowances.tripEvidenceId,
                  withdrawn.map((w) => w.id),
                ),
                isNull(schema.umpeTripEvidenceAllowances.revokedAt),
              ),
            )
            .returning({ id: schema.umpeTripEvidenceAllowances.id });
    const missionIds = ended.map((e) => e.missionId);
    const unlabelled = await tx
      .update(schema.missions)
      .set({ itineraryRef: null, updatedAt: now })
      .where(
        and(
          inArray(schema.missions.id, missionIds),
          eq(schema.missions.applicantId, applicantId),
          eq(schema.missions.itineraryRef, trip.value.itineraryRef),
        ),
      )
      .returning({ id: schema.missions.id });
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_TRAVELLER_REMOVED',
      actorAccountId: owner.value,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'umpe_trip',
      resourceId: trip.value.id,
      metadata: {
        allowancesRevoked: revoked.length + ownRevoked.length,
        documentsWithdrawn: withdrawn.length,
        labelsCleared: unlabelled.length,
      },
    });
    return ok({ removed: true });
  });
}

/** The account holder's trips, newest first (owner proof of any traveller they manage). */
export async function listTrips(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<readonly TripSummary[], ServiceError>> {
  const owner = ownerAccountOf(proof, 'VIEW_METADATA');
  if (!owner.ok) return owner;
  if (!(await tripTablesPresent(proof.tx))) return ok([]);
  const trips = await proof.tx
    .select()
    .from(schema.umpeTrips)
    .where(eq(schema.umpeTrips.ownerAccountId, owner.value))
    .orderBy(desc(schema.umpeTrips.createdAt))
    .limit(LIST_LIMIT);
  if (trips.length === 0) return ok([]);
  const lifecycle = await lifecycleTablesPresent(proof.tx);
  const counts = await proof.tx
    .select({ tripId: schema.umpeTripTravellers.tripId, n: count() })
    .from(schema.umpeTripTravellers)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.umpeTripTravellers.applicantId))
    .where(
      and(
        inArray(
          schema.umpeTripTravellers.tripId,
          trips.map((t) => t.id),
        ),
        isNull(schema.umpeTripTravellers.removedAt),
        eq(schema.applicants.ownerAccountId, owner.value),
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    )
    .groupBy(schema.umpeTripTravellers.tripId);
  const byTrip = new Map(counts.map((c) => [c.tripId, Number(c.n)]));
  return ok(
    trips.map((t) => ({
      id: t.id,
      title: t.title,
      destination: t.destination,
      purpose: t.purpose,
      travellerCount: byTrip.get(t.id) ?? 0,
      createdAt: t.createdAt.toISOString(),
    })),
  );
}

/**
 * One trip with who is travelling: each traveller's own case (title and state), never their
 * package contents. The page reads each traveller's readiness through their own case proof.
 * Travellers in Recently Deleted and purged cases are left out.
 */
export async function getTrip(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  tripId: string,
): Promise<Result<TripView, ServiceError>> {
  const owner = ownerAccountOf(proof, 'VIEW_METADATA');
  if (!owner.ok) return owner;
  if (!(await tripTablesPresent(proof.tx)))
    return err(serviceError('not_found', TRIP_NOT_AVAILABLE));
  const trip = await ownedTrip(proof.tx, owner.value, tripId);
  if (!trip.ok) return trip;
  const lifecycle = await lifecycleTablesPresent(proof.tx);
  const rows = await proof.tx
    .select({
      applicantId: schema.umpeTripTravellers.applicantId,
      missionId: schema.umpeTripTravellers.missionId,
      addedAt: schema.umpeTripTravellers.addedAt,
      name: schema.applicants.displayName,
      relationship: schema.applicants.relationship,
      caseTitle: schema.missions.title,
      caseState: schema.missions.state,
    })
    .from(schema.umpeTripTravellers)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.umpeTripTravellers.applicantId))
    .innerJoin(schema.missions, eq(schema.missions.id, schema.umpeTripTravellers.missionId))
    .where(
      and(
        eq(schema.umpeTripTravellers.tripId, trip.value.id),
        isNull(schema.umpeTripTravellers.removedAt),
        eq(schema.applicants.ownerAccountId, owner.value),
        eq(schema.missions.applicantId, schema.umpeTripTravellers.applicantId),
        isNull(schema.missions.purgedAt),
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    )
    .orderBy(schema.umpeTripTravellers.addedAt);
  return ok({
    id: trip.value.id,
    title: trip.value.title,
    destination: trip.value.destination,
    purpose: trip.value.purpose,
    itineraryRef: trip.value.itineraryRef,
    createdAt: trip.value.createdAt.toISOString(),
    travellers: rows.map((r) => ({
      applicantId: r.applicantId,
      missionId: r.missionId,
      name: r.name,
      relationship: r.relationship,
      caseTitle: r.caseTitle,
      caseState: r.caseState,
      addedAt: r.addedAt.toISOString(),
    })),
  });
}

/**
 * Add one traveller's own travel document (a booking, itinerary, invitation or accommodation
 * proof) as common trip evidence. The proof is MANAGE on that document; its traveller must be on
 * the trip. It is a reference, never a copy, and no other traveller sees it until allowed.
 */
export async function addTripEvidence(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
): Promise<Result<{ readonly evidenceId: string; readonly added: boolean }, ServiceError>> {
  const owner = ownerAccountOf(proof, 'MANAGE');
  if (!owner.ok) return owner;
  const resource = proof.resource;
  if (resource.kind !== 'document' || resource.document.applicantId !== proof.applicant.id) {
    return err(serviceError('invalid', 'Choose a document that belongs to this traveller.'));
  }
  if (!(await tripTablesPresent(proof.tx))) return err(serviceError('invalid', NOT_SWITCHED_ON));
  const trip = await ownedTrip(proof.tx, owner.value, tripId);
  if (!trip.ok) return trip;
  if (!(await liveTraveller(proof.tx, trip.value.id, proof.applicant.id))) {
    return err(serviceError('invalid', 'Add this traveller to the trip first.'));
  }
  if (!isCommonTripEvidenceType(resource.document.docType)) {
    return err(
      serviceError(
        'invalid',
        'Only travel documents such as bookings, itineraries and invitations can be shared across a trip.',
      ),
    );
  }
  if (await lifecycleTablesPresent(proof.tx)) {
    const present = first(
      await proof.tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, resource.document.id),
            eq(schema.documents.applicantId, proof.applicant.id),
            presentDocumentCondition(),
          ),
        )
        .limit(1),
    );
    if (!present) return err(serviceError('not_found', 'That document is not available.'));
  }
  return proof.tx.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.umpeTripEvidence)
      .values({
        tripId: trip.value.id,
        sourceApplicantId: proof.applicant.id,
        documentId: resource.document.id,
        addedByAccountId: owner.value,
      })
      .onConflictDoNothing()
      .returning({ id: schema.umpeTripEvidence.id });
    const row = inserted[0];
    if (!row) {
      const existing = first(
        await tx
          .select({ id: schema.umpeTripEvidence.id })
          .from(schema.umpeTripEvidence)
          .where(
            and(
              eq(schema.umpeTripEvidence.tripId, trip.value.id),
              eq(schema.umpeTripEvidence.documentId, resource.document.id),
              isNull(schema.umpeTripEvidence.removedAt),
            ),
          )
          .limit(1),
      );
      if (!existing) return err(serviceError('stale', 'Try again.'));
      return ok({ evidenceId: existing.id, added: false });
    }
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_EVIDENCE_ADDED',
      actorAccountId: owner.value,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proof.applicant.id,
      resourceType: 'umpe_trip',
      resourceId: trip.value.id,
      metadata: { allowances: 0 },
    });
    return ok({ evidenceId: row.id, added: true });
  });
}

/** The live common document `evidenceId` of this trip, or a refusal that looks missing. */
async function liveEvidence(db: Db, tripId: string, evidenceId: string) {
  if (!UUID.test(evidenceId)) return undefined;
  return first(
    await db
      .select()
      .from(schema.umpeTripEvidence)
      .where(
        and(
          eq(schema.umpeTripEvidence.id, evidenceId),
          eq(schema.umpeTripEvidence.tripId, tripId),
          isNull(schema.umpeTripEvidence.removedAt),
        ),
      )
      .limit(1),
  );
}

/**
 * Stop sharing a common document across the trip (MANAGE proof on its traveller). Every allowance
 * ends; the document itself stays in its traveller's own documents.
 */
export async function removeTripEvidence(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
  evidenceId: string,
): Promise<Result<{ readonly removed: boolean }, ServiceError>> {
  const owner = travellerProof(proof, 'MANAGE');
  if (!owner.ok) return owner;
  if (!(await tripTablesPresent(proof.tx))) return err(serviceError('invalid', NOT_SWITCHED_ON));
  const trip = await ownedTrip(proof.tx, owner.value, tripId);
  if (!trip.ok) return trip;
  const evidence = await liveEvidence(proof.tx, trip.value.id, evidenceId);
  if (!evidence || evidence.sourceApplicantId !== proof.applicant.id) {
    return err(serviceError('not_found', 'That shared document is not available.'));
  }
  return proof.tx.transaction(async (tx) => {
    const now = new Date();
    const removed = await tx
      .update(schema.umpeTripEvidence)
      .set({ removedAt: now })
      .where(
        and(eq(schema.umpeTripEvidence.id, evidence.id), isNull(schema.umpeTripEvidence.removedAt)),
      )
      .returning({ id: schema.umpeTripEvidence.id });
    if (removed.length === 0) return ok({ removed: false });
    const revoked = await tx
      .update(schema.umpeTripEvidenceAllowances)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.umpeTripEvidenceAllowances.tripEvidenceId, evidence.id),
          isNull(schema.umpeTripEvidenceAllowances.revokedAt),
        ),
      )
      .returning({ id: schema.umpeTripEvidenceAllowances.id });
    await appendAuditEvent(tx, {
      eventType: 'UMPE_TRIP_EVIDENCE_REMOVED',
      actorAccountId: owner.value,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proof.applicant.id,
      resourceType: 'umpe_trip',
      resourceId: trip.value.id,
      metadata: { allowancesRevoked: revoked.length },
    });
    return ok({ removed: true });
  });
}

/**
 * Allow, or stop allowing, one common trip document to be referenced for one traveller. The proof
 * is MANAGE on that traveller: only their owner decides, one traveller at a time, never by
 * default. A traveller's own document needs no allowance.
 */
export async function setTripEvidenceAllowance(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
  evidenceId: string,
  allowed: boolean,
): Promise<Result<{ readonly changed: boolean }, ServiceError>> {
  const owner = travellerProof(proof, 'MANAGE');
  if (!owner.ok) return owner;
  if (!(await tripTablesPresent(proof.tx))) return err(serviceError('invalid', NOT_SWITCHED_ON));
  const trip = await ownedTrip(proof.tx, owner.value, tripId);
  if (!trip.ok) return trip;
  const evidence = await liveEvidence(proof.tx, trip.value.id, evidenceId);
  if (!evidence) return err(serviceError('not_found', 'That shared document is not available.'));
  if (evidence.sourceApplicantId === proof.applicant.id) {
    return err(serviceError('invalid', 'This document already belongs to this traveller.'));
  }
  if (allowed && !(await liveTraveller(proof.tx, trip.value.id, proof.applicant.id))) {
    return err(serviceError('invalid', 'Add this traveller to the trip first.'));
  }
  return proof.tx.transaction(async (tx) => {
    const changed = allowed
      ? await tx
          .insert(schema.umpeTripEvidenceAllowances)
          .values({
            tripEvidenceId: evidence.id,
            applicantId: proof.applicant.id,
            allowedByAccountId: owner.value,
          })
          .onConflictDoNothing()
          .returning({ id: schema.umpeTripEvidenceAllowances.id })
      : await tx
          .update(schema.umpeTripEvidenceAllowances)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.umpeTripEvidenceAllowances.tripEvidenceId, evidence.id),
              eq(schema.umpeTripEvidenceAllowances.applicantId, proof.applicant.id),
              isNull(schema.umpeTripEvidenceAllowances.revokedAt),
            ),
          )
          .returning({ id: schema.umpeTripEvidenceAllowances.id });
    if (changed.length === 0) return ok({ changed: false });
    await appendAuditEvent(tx, {
      eventType: allowed ? 'UMPE_TRIP_EVIDENCE_ALLOWED' : 'UMPE_TRIP_EVIDENCE_REVOKED',
      actorAccountId: owner.value,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proof.applicant.id,
      resourceType: 'umpe_trip',
      resourceId: trip.value.id,
      metadata: { allowances: changed.length },
    });
    return ok({ changed: true });
  });
}

/** Live common documents of a trip, joined to their documents (present ones only). */
async function evidenceRows(db: Db, tripId: string, ownerAccountId: string) {
  const lifecycle = await lifecycleTablesPresent(db);
  return db
    .select({
      id: schema.umpeTripEvidence.id,
      documentId: schema.umpeTripEvidence.documentId,
      sourceApplicantId: schema.umpeTripEvidence.sourceApplicantId,
      approvedName: schema.documents.approvedName,
      originalName: schema.documents.originalName,
      docType: schema.documents.docType,
    })
    .from(schema.umpeTripEvidence)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.umpeTripEvidence.documentId))
    .innerJoin(
      schema.applicants,
      eq(schema.applicants.id, schema.umpeTripEvidence.sourceApplicantId),
    )
    .innerJoin(
      schema.umpeTripTravellers,
      and(
        eq(schema.umpeTripTravellers.tripId, schema.umpeTripEvidence.tripId),
        eq(schema.umpeTripTravellers.applicantId, schema.umpeTripEvidence.sourceApplicantId),
        isNull(schema.umpeTripTravellers.removedAt),
      ),
    )
    .where(
      and(
        eq(schema.umpeTripEvidence.tripId, tripId),
        isNull(schema.umpeTripEvidence.removedAt),
        eq(schema.documents.applicantId, schema.umpeTripEvidence.sourceApplicantId),
        eq(schema.applicants.ownerAccountId, ownerAccountId),
        lifecycle ? presentDocumentCondition() : undefined,
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    )
    .orderBy(schema.umpeTripEvidence.addedAt);
}

/**
 * Every common document of the trip with the travellers its owner allowed it for: the account
 * holder's management view (owner proof of any traveller they manage).
 */
export async function listTripEvidence(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  tripId: string,
): Promise<Result<readonly TripEvidenceView[], ServiceError>> {
  const owner = ownerAccountOf(proof, 'VIEW_METADATA');
  if (!owner.ok) return owner;
  if (!(await tripTablesPresent(proof.tx)))
    return err(serviceError('not_found', TRIP_NOT_AVAILABLE));
  const trip = await ownedTrip(proof.tx, owner.value, tripId);
  if (!trip.ok) return trip;
  const rows = await evidenceRows(proof.tx, trip.value.id, owner.value);
  if (rows.length === 0) return ok([]);
  const allowances = await proof.tx
    .select({
      tripEvidenceId: schema.umpeTripEvidenceAllowances.tripEvidenceId,
      applicantId: schema.umpeTripEvidenceAllowances.applicantId,
    })
    .from(schema.umpeTripEvidenceAllowances)
    .innerJoin(
      schema.umpeTripTravellers,
      and(
        eq(schema.umpeTripTravellers.tripId, trip.value.id),
        eq(schema.umpeTripTravellers.applicantId, schema.umpeTripEvidenceAllowances.applicantId),
        isNull(schema.umpeTripTravellers.removedAt),
      ),
    )
    .where(
      and(
        inArray(
          schema.umpeTripEvidenceAllowances.tripEvidenceId,
          rows.map((r) => r.id),
        ),
        isNull(schema.umpeTripEvidenceAllowances.revokedAt),
      ),
    );
  return ok(
    rows.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      documentName: r.approvedName ?? r.originalName,
      docType: r.docType,
      sourceApplicantId: r.sourceApplicantId,
      allowedFor: allowances
        .filter((a) => a.tripEvidenceId === r.id)
        .map((a) => a.applicantId)
        .sort(),
    })),
  );
}

/**
 * The common documents referenced for ONE traveller: their own, and the ones their owner allowed
 * for them. A common document nobody allowed for this traveller is not here.
 */
export async function listTripEvidenceForTraveller(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  tripId: string,
): Promise<Result<readonly TravellerTripEvidenceView[], ServiceError>> {
  const owner = travellerProof(proof, 'VIEW_METADATA');
  if (!owner.ok) return owner;
  if (!(await tripTablesPresent(proof.tx)))
    return err(serviceError('not_found', TRIP_NOT_AVAILABLE));
  const trip = await ownedTrip(proof.tx, owner.value, tripId);
  if (!trip.ok) return trip;
  const applicantId = proof.applicant.id;
  if (!(await liveTraveller(proof.tx, trip.value.id, applicantId))) return ok([]);
  const rows = await evidenceRows(proof.tx, trip.value.id, owner.value);
  if (rows.length === 0) return ok([]);
  const allowed = new Set(
    (
      await proof.tx
        .select({ id: schema.umpeTripEvidenceAllowances.tripEvidenceId })
        .from(schema.umpeTripEvidenceAllowances)
        .where(
          and(
            inArray(
              schema.umpeTripEvidenceAllowances.tripEvidenceId,
              rows.map((r) => r.id),
            ),
            eq(schema.umpeTripEvidenceAllowances.applicantId, applicantId),
            isNull(schema.umpeTripEvidenceAllowances.revokedAt),
          ),
        )
    ).map((r) => r.id),
  );
  return ok(
    rows
      .filter((r) => r.sourceApplicantId === applicantId || allowed.has(r.id))
      .map((r) => ({
        id: r.id,
        documentName: r.approvedName ?? r.originalName,
        docType: r.docType,
        own: r.sourceApplicantId === applicantId,
      })),
  );
}
