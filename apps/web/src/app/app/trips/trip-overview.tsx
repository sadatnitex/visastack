import {
  COMPANION_SHARE_LEVEL_LABELS,
  type OrganiserCompanionStatus,
  type OrganiserCompanionView,
  PACKAGE_PHRASE_LABELS,
  type PackagePhrase,
  TRIP_NEXT_ACTION_LABELS,
  type TripNextAction,
  type TripRelationship,
} from '@visastack/services';
import Link from 'next/link';
import { NextStepCard } from '../../../components/ui';
import {
  AddTravellersForm,
  AddTripEvidenceForm,
  RemoveCompanionForm,
  RemoveTravellerForm,
  RemoveTripEvidenceForm,
  ResendCompanionForm,
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

/** Where each readiness phrase sits among the three, so a card can show how far along it is. */
const PHRASE_STAGE: Readonly<Record<PackagePhrase, number>> = {
  NEEDS_ATTENTION: 1,
  READY_FOR_FINAL_REVIEW: 2,
  PREPARED_FOR_HANDOFF: 3,
};
const STAGES = ['stage-1', 'stage-2', 'stage-3'] as const;

/**
 * The one traveller to look at first: someone who needs attention, then someone ready for a final
 * review. Nobody is singled out when every package is prepared (nothing is waiting on the person).
 */
function whoNext(travellers: readonly TripTravellerCard[]): TripTravellerCard | null {
  return (
    travellers.find((t) => t.phrase === 'NEEDS_ATTENTION') ??
    travellers.find((t) => t.phrase === 'READY_FOR_FINAL_REVIEW') ??
    null
  );
}

/** How far a package is along its three stages: a bar for the eye, one sentence for a screen reader. */
function TripTrack({ phrase }: { readonly phrase: PackagePhrase }) {
  const stage = PHRASE_STAGE[phrase];
  return (
    <span
      className="trip-track"
      role="img"
      aria-label={`${PACKAGE_PHRASE_LABELS[phrase]}, stage ${stage} of 3`}
    >
      {STAGES.map((name, at) => (
        <i key={name} className={at < stage ? 'trip-track-on' : ''} />
      ))}
    </span>
  );
}

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

/** The one state word for someone travelling with the organiser. Words, never colour alone. */
const COMPANION_STATE_WORDS: Readonly<Record<OrganiserCompanionStatus, string>> = {
  NAME_ONLY: 'Not on VisaStack Yet',
  INVITED: 'Invited',
  EXPIRED: 'Invitation Expired',
  JOINED: 'Joined',
};

/**
 * Travelling with You: the people added by name (and email) who are not the account holder's own
 * managed people. Only what the service returns for the organiser is shown: a name, one state
 * word and, for someone who joined, what they chose to share. Never an address, a link or anything
 * about an account. Rendered only when the feature is on and there is at least one person.
 */
function TripCompanions({
  tripId,
  companions,
}: {
  readonly tripId: string;
  readonly companions: readonly OrganiserCompanionView[];
}) {
  return (
    <section className="card trip-section" aria-labelledby="trip-companions-title">
      <h2 id="trip-companions-title" className="card-title">
        Travelling with You
      </h2>
      <ul className="trip-traveller-list">
        {companions.map((c) => (
          <li key={c.id} className="trip-traveller">
            <div className="trip-traveller-head">
              <h3 className="trip-traveller-name">{c.name}</h3>
              <span className="badge badge-neutral">{COMPANION_STATE_WORDS[c.status]}</span>
            </div>
            {c.status === 'JOINED' && c.shareLevel ? (
              <p className="muted u-fs-085 u-m-0">
                Shares {COMPANION_SHARE_LEVEL_LABELS[c.shareLevel]}
                {c.planStatus ? `: ${c.planStatus}` : ''}
              </p>
            ) : null}
            {c.status === 'JOINED' && c.papers.length > 0 ? (
              <p className="muted u-fs-085 u-m-0">
                Papers: {c.papers.map((paper) => `${paper.name} (${paper.kind})`).join(', ')}
              </p>
            ) : null}
            <div className="trip-companion-actions">
              {c.status === 'INVITED' || c.status === 'EXPIRED' ? (
                <ResendCompanionForm tripId={tripId} companionId={c.id} name={c.name} />
              ) : null}
              <RemoveCompanionForm tripId={tripId} companionId={c.id} name={c.name} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TripOverview({
  tripId,
  travellers,
  sharedDocuments,
  addable,
  documentOptions,
  companionsOn = false,
  companions = [],
}: {
  readonly tripId: string;
  readonly travellers: readonly TripTravellerCard[];
  readonly sharedDocuments: readonly TripSharedDocument[];
  readonly addable: readonly TripTravellerOption[];
  readonly documentOptions: readonly TripDocumentOption[];
  /** Whether travelling with someone else is on. Decided on the server; off (or missing) shows nothing new. */
  readonly companionsOn?: boolean;
  readonly companions?: readonly OrganiserCompanionView[];
}) {
  const next = whoNext(travellers);
  return (
    <>
      {next?.phrase ? (
        <NextStepCard
          title={`${next.name}: ${TRIP_NEXT_ACTION_LABELS[next.nextAction]}`}
          why={`${next.caseTitle}: ${PACKAGE_PHRASE_LABELS[next.phrase]}.`}
          href={`/app/mission/${next.missionId}#trip-package`}
          action={TRIP_NEXT_ACTION_LABELS[next.nextAction]}
        />
      ) : null}
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
                {t.phrase ? <TripTrack phrase={t.phrase} /> : null}
                <p className="u-m-0">
                  <Link
                    className="btn btn-secondary trip-next-action"
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

      {companionsOn && companions.length > 0 ? (
        <TripCompanions tripId={tripId} companions={companions} />
      ) : null}

      <section className="card trip-section" aria-labelledby="trip-add-title">
        <h2 id="trip-add-title" className="card-title">
          Add Travellers
        </h2>
        <AddTravellersForm
          // Who is on the trip changing (someone was added) starts the form fresh. A new person
          // made while something else failed does not, so the message and their tick stay.
          key={travellers.map((t) => t.applicantId).join(',')}
          tripId={tripId}
          travellers={addable}
          companionsOn={companionsOn}
        />
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
                    .map((t) => {
                      const allowed = d.allowedFor.includes(t.applicantId);
                      return (
                        <div key={t.applicantId} className="trip-allow">
                          <span className="trip-allow-who">{t.name}</span>
                          <span className={`trip-allow-state${allowed ? ' trip-allow-on' : ''}`}>
                            {allowed ? 'Allowed' : 'Not Allowed'}
                          </span>
                          <TripEvidenceAllowanceForm
                            tripId={tripId}
                            evidenceId={d.id}
                            applicantId={t.applicantId}
                            travellerName={t.name}
                            documentName={d.name}
                            allowed={allowed}
                          />
                        </div>
                      );
                    })}
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
