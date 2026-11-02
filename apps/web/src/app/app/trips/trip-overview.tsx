import {
  PACKAGE_PHRASE_LABELS,
  type PackagePhrase,
  TRIP_NEXT_ACTION_LABELS,
  type TripNextAction,
  type TripRelationship,
} from '@visastack/services';
import Link from 'next/link';
import {
  AddTravellersForm,
  AddTripEvidenceForm,
  RemoveTravellerForm,
  RemoveTripEvidenceForm,
  type TripDocumentOption,
  TripEvidenceAllowanceForm,
  type TripTravellerOption,
} from './trip-forms';

/**
 * UMPE P5: one group trip. Each traveller's own readiness phrase and the one next action, from
 * their own case; the shared trip documents and, for each, who its owner allowed it for. Nothing
 * here merges travellers or shares anything automatically.
 */

const PHRASE_TONE: Readonly<Record<PackagePhrase, string>> = {
  NEEDS_ATTENTION: 'badge-warning',
  READY_FOR_FINAL_REVIEW: 'badge-neutral',
  PREPARED_FOR_HANDOFF: 'badge-success',
};

const RELATIONSHIP_WORDS: Readonly<Record<TripRelationship, string>> = {
  SELF: 'You',
  FAMILY_MEMBER: 'Family Member',
  MINOR_GUARDIAN: 'Child in Your Care',
};

export interface TripTravellerCard {
  readonly applicantId: string;
  readonly missionId: string;
  readonly name: string;
  readonly relationship: TripRelationship;
  readonly caseTitle: string;
  /** Null when the case's package could not be read just now. */
  readonly phrase: PackagePhrase | null;
  readonly nextAction: TripNextAction;
  /** The shared trip documents this traveller may use (their own, or allowed for them). */
  readonly tripDocuments: readonly {
    readonly id: string;
    readonly name: string;
    readonly own: boolean;
  }[];
}

export interface TripSharedDocument {
  readonly id: string;
  readonly name: string;
  readonly sourceApplicantId: string;
  readonly sourceName: string;
  readonly allowedFor: readonly string[];
}

export function TripOverview({
  tripId,
  travellers,
  sharedDocuments,
  addable,
  documentOptions,
}: {
  readonly tripId: string;
  readonly travellers: readonly TripTravellerCard[];
  readonly sharedDocuments: readonly TripSharedDocument[];
  readonly addable: readonly TripTravellerOption[];
  readonly documentOptions: readonly TripDocumentOption[];
}) {
  return (
    <>
      <section className="card trip-section" aria-labelledby="trip-travellers-title">
        <h2 id="trip-travellers-title" className="card-title">
          Who&apos;s Travelling?
        </h2>
        {travellers.length === 0 ? (
          <p className="u-m-0">Nobody is on this trip yet. Add Travellers below.</p>
        ) : (
          <ul className="trip-traveller-list">
            {travellers.map((t) => (
              <li key={t.applicantId} className="trip-traveller">
                <div className="trip-traveller-head">
                  <h3 className="trip-traveller-name">{t.name}</h3>
                  <span className="muted u-fs-085">{RELATIONSHIP_WORDS[t.relationship]}</span>
                </div>
                <p className="u-m-0">
                  {t.phrase ? (
                    <span className={`badge ${PHRASE_TONE[t.phrase]}`}>
                      {PACKAGE_PHRASE_LABELS[t.phrase]}
                    </span>
                  ) : (
                    <span className="muted">Open the case to see where it stands.</span>
                  )}
                </p>
                <p className="u-m-0">
                  <Link
                    className="btn btn-primary trip-next-action"
                    href={`/app/mission/${t.missionId}#trip-package`}
                    aria-label={`${TRIP_NEXT_ACTION_LABELS[t.nextAction]}: ${t.name}`}
                  >
                    {TRIP_NEXT_ACTION_LABELS[t.nextAction]}
                  </Link>
                </p>
                <p className="muted u-fs-085 u-m-0">Case: {t.caseTitle}</p>
                {t.tripDocuments.length > 0 ? (
                  <p className="u-fs-085 u-m-0">
                    Shared Trip Documents: {t.tripDocuments.map((d) => d.name).join(', ')}
                  </p>
                ) : null}
                <RemoveTravellerForm tripId={tripId} applicantId={t.applicantId} name={t.name} />
              </li>
            ))}
          </ul>
        )}
        <p className="muted u-fs-085">
          Each traveller has their own case, checklist, documents and privacy. Their readiness is
          not a submission, and nothing is sent until you share it yourself.
        </p>
      </section>

      <section className="card trip-section" aria-labelledby="trip-add-title">
        <h2 id="trip-add-title" className="card-title">
          Add Travellers
        </h2>
        {addable.length > 0 ? (
          <AddTravellersForm tripId={tripId} travellers={addable} />
        ) : (
          <p className="u-m-0">Everyone you manage is already on this trip.</p>
        )}
        <p className="muted u-fs-085">
          Travelling with an adult who has their own VisaStack account? They start their own case
          from their account and choose for themselves whether to share it with you. We never add or
          change someone else&apos;s records.
        </p>
      </section>

      <section className="card trip-section" aria-labelledby="trip-documents-title">
        <h2 id="trip-documents-title" className="card-title">
          Shared Trip Documents
        </h2>
        <p className="muted u-fs-085">
          A shared booking or itinerary stays in its traveller&apos;s documents. It is used for
          another traveller only after you allow it for them.
        </p>
        {sharedDocuments.length > 0 ? (
          <ul className="trip-document-list">
            {sharedDocuments.map((d) => (
              <li key={d.id} className="trip-document">
                <p className="u-m-0">
                  <strong>{d.name}</strong>{' '}
                  <span className="muted u-fs-085">From {d.sourceName}</span>
                </p>
                <div className="trip-document-actions">
                  {travellers
                    .filter((t) => t.applicantId !== d.sourceApplicantId)
                    .map((t) => (
                      <TripEvidenceAllowanceForm
                        key={t.applicantId}
                        tripId={tripId}
                        evidenceId={d.id}
                        applicantId={t.applicantId}
                        travellerName={t.name}
                        documentName={d.name}
                        allowed={d.allowedFor.includes(t.applicantId)}
                      />
                    ))}
                  <RemoveTripEvidenceForm
                    tripId={tripId}
                    evidenceId={d.id}
                    applicantId={d.sourceApplicantId}
                    documentName={d.name}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {documentOptions.length > 0 ? (
          <AddTripEvidenceForm tripId={tripId} documents={documentOptions} />
        ) : (
          <p className="u-m-0">
            No travel documents to share yet. Add a booking or itinerary to a traveller&apos;s
            documents first.
          </p>
        )}
      </section>
    </>
  );
}
