import {
  type Db,
  type OrganiserCompanionView,
  type TripSummary,
  accountPrincipal,
  getCasePackage,
  getTrip,
  isCommonTripEvidenceType,
  listApplicants,
  listCompanions,
  listDocuments,
  listMyCompanionTrips,
  listTripEvidence,
  listTrips,
  requireAccess,
  tripCompanionsAvailable,
  tripNextAction,
} from '@visastack/services';
import type { TripDocumentOption, TripTravellerOption } from './trip-forms';
import type { TripSharedDocument, TripTravellerCard } from './trip-overview';

/**
 * UMPE P5: what the trip pages read. Every read goes through the access gate as the owner of the
 * traveller (or case) it is about. The trip itself is read with the owner proof of any traveller
 * the account manages; each traveller's readiness with the proof for their own case.
 */

const PURPOSE = 'owner_trip';

/** An owner proof that identifies the signed-in account holder, or null when they manage nobody. */
async function accountProof(db: Db, accountId: string, applicantId: string | undefined) {
  if (!applicantId) return null;
  const proof = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: PURPOSE },
  );
  return proof.ok ? proof.value : null;
}

export async function loadTripList(
  db: Db,
  accountId: string,
): Promise<{ readonly trips: readonly TripSummary[]; readonly hasTravellers: boolean }> {
  const applicants = await listApplicants(db, accountId);
  const proof = await accountProof(db, accountId, applicants[0]?.id);
  if (!proof) return { trips: [], hasTravellers: applicants.length > 0 };
  const trips = await listTrips(proof);
  return { trips: trips.ok ? trips.value : [], hasTravellers: true };
}

/** One row of Trips You Joined: a trip the person joined, or an invitation still waiting for them. */
export interface JoinedTripRow {
  readonly key: string;
  readonly tripId: string;
  readonly title: string;
  readonly destination: string;
  /** True for a trip they joined; false for an invitation that has not been answered. */
  readonly joined: boolean;
  /** When a waiting invitation ends (empty once joined). */
  readonly endsAt: string;
}

/**
 * The trips the signed-in account joined as someone travelling with an organiser, then invitations
 * waiting for its verified email. Empty while travelling with someone else is off or the table is
 * missing. A waiting invitation carries no link: only the emailed link can answer it.
 */
export async function loadJoinedTrips(db: Db, accountId: string): Promise<JoinedTripRow[]> {
  const trips = await listMyCompanionTrips(db, accountId);
  return trips.map((trip) => ({
    key: `${trip.standing}-${trip.tripId}`,
    tripId: trip.tripId,
    title: trip.title,
    destination: trip.destination,
    joined: trip.standing === 'JOINED',
    endsAt: trip.expiresAt ?? '',
  }));
}

/** True when this trip belongs to the signed-in account (the layout's 404 gate). */
export async function tripExists(db: Db, accountId: string, tripId: string): Promise<boolean> {
  const applicants = await listApplicants(db, accountId);
  const proof = await accountProof(db, accountId, applicants[0]?.id);
  if (!proof) return false;
  return (await getTrip(proof, tripId)).ok;
}

export interface TripPageData {
  readonly id: string;
  readonly title: string;
  readonly destination: string;
  readonly purpose: string;
  readonly travellers: readonly TripTravellerCard[];
  readonly sharedDocuments: readonly TripSharedDocument[];
  readonly addable: readonly TripTravellerOption[];
  readonly documentOptions: readonly TripDocumentOption[];
  /** Whether travelling with someone else is on (the switch is on and its table exists). */
  readonly companionsOn: boolean;
  /** The people added by name, as the organiser may see them; empty while the feature is off. */
  readonly companions: readonly OrganiserCompanionView[];
}

export async function loadTripPage(
  db: Db,
  accountId: string,
  tripId: string,
): Promise<TripPageData | null> {
  const applicants = await listApplicants(db, accountId);
  const proof = await accountProof(db, accountId, applicants[0]?.id);
  if (!proof) return null;
  const trip = await getTrip(proof, tripId);
  if (!trip.ok) return null;
  const companionsOn = await tripCompanionsAvailable(db);
  const people = companionsOn ? await listCompanions(proof, tripId) : null;
  const evidence = await listTripEvidence(proof, tripId);
  const shared = evidence.ok ? evidence.value : [];

  const travellers: TripTravellerCard[] = [];
  for (const t of trip.value.travellers) {
    const caseProof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { missionId: t.missionId },
      { purpose: PURPOSE },
    );
    const pkg = caseProof.ok ? await getCasePackage(caseProof.value, t.missionId) : null;
    travellers.push({
      applicantId: t.applicantId,
      missionId: t.missionId,
      name: t.name,
      relationship: t.relationship,
      caseTitle: t.caseTitle,
      phrase: pkg?.ok ? pkg.value.phrase : null,
      nextAction: pkg?.ok
        ? tripNextAction({
            phrase: pkg.value.phrase,
            reasons: pkg.value.reasons,
            hasChange: pkg.value.change !== null,
            active: pkg.value.active,
          })
        : 'VIEW_CASE',
      // Their own shared documents and the ones allowed for them, nothing else.
      tripDocuments: shared
        .filter(
          (d) => d.sourceApplicantId === t.applicantId || d.allowedFor.includes(t.applicantId),
        )
        .map((d) => ({
          id: d.id,
          name: d.documentName,
          own: d.sourceApplicantId === t.applicantId,
        })),
    });
  }

  const names = new Map(trip.value.travellers.map((t) => [t.applicantId, t.name]));
  const onTrip = new Set(trip.value.travellers.map((t) => t.applicantId));
  const alreadyShared = new Set(shared.map((d) => d.documentId));
  const documentOptions: TripDocumentOption[] = [];
  for (const t of trip.value.travellers) {
    const docs = await listDocuments(db, accountId, t.applicantId, { lifecycle: 'everyday' });
    if (!docs.ok) continue;
    for (const d of docs.value) {
      if (alreadyShared.has(d.id) || !isCommonTripEvidenceType(d.docType)) continue;
      documentOptions.push({
        documentId: d.id,
        label: `${d.approvedName ?? d.originalName} (${t.name})`,
      });
    }
  }

  return {
    id: trip.value.id,
    title: trip.value.title,
    destination: trip.value.destination,
    purpose: trip.value.purpose,
    travellers,
    sharedDocuments: shared.map((d) => ({
      id: d.id,
      name: d.documentName,
      sourceApplicantId: d.sourceApplicantId,
      sourceName: names.get(d.sourceApplicantId) ?? 'A Traveller',
      allowedFor: d.allowedFor,
    })),
    addable: applicants
      .filter((a) => !onTrip.has(a.id))
      .map((a) => ({ applicantId: a.id, name: a.displayName })),
    documentOptions,
    companionsOn,
    companions: people?.ok ? people.value : [],
  };
}
