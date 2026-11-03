'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../components/form-feedback';
import type { CaseCountryOption, CasePurposeGroup } from '../../../lib/case-choices';
import {
  addTravellersAction,
  addTripEvidenceAction,
  removeTravellerAction,
  removeTripEvidenceAction,
  startGroupTripAction,
  tripEvidenceAllowanceAction,
} from './actions';

/** A traveller the account holder manages, as the forms offer them. */
export interface TripTravellerOption {
  readonly applicantId: string;
  readonly name: string;
}

/** A travel document one traveller could share with the trip. */
export interface TripDocumentOption {
  readonly documentId: string;
  readonly label: string;
}

/** The ticked-travellers list, controlled so a refused try keeps what was chosen. */
function TravellerChecklist({
  legend,
  travellers,
  state,
  messageId,
  initial,
}: {
  readonly legend: string;
  readonly travellers: readonly TripTravellerOption[];
  readonly state: FormResult;
  readonly messageId: string;
  readonly initial: readonly string[];
}) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(initial));
  const toggle = (applicantId: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(applicantId);
      else next.delete(applicantId);
      return next;
    });
  return (
    <fieldset className="trip-travellers-choice">
      <legend className="label">{legend}</legend>
      {travellers.map((t, index) => (
        <label key={t.applicantId} className="package-check">
          <input
            type="checkbox"
            name="traveller"
            value={t.applicantId}
            checked={chosen.has(t.applicantId)}
            onChange={(e) => toggle(t.applicantId, e.target.checked)}
            {...(index === 0 ? fieldProblem(state, 'traveller', messageId) : {})}
          />
          <span>{t.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * UMPE P5: start a group trip. Where, why and who; each traveller gets their own case (or their
 * existing case for the same trip), and the trip groups them without merging anything.
 */
export function GroupTripStartForm({
  countries,
  purposes,
  travellers,
}: {
  readonly countries: readonly CaseCountryOption[];
  readonly purposes: readonly CasePurposeGroup[];
  readonly travellers: readonly TripTravellerOption[];
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    startGroupTripAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  return (
    <form ref={form} action={formAction} className="trip-start-form">
      <label className="label" htmlFor={`${id}-destination`}>
        Where Are You Going?
      </label>
      <select
        id={`${id}-destination`}
        name="destination"
        className="input"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        {...fieldProblem(state, 'destination', messageId)}
      >
        <option value="" disabled>
          Choose a Country
        </option>
        {countries.map((country) => (
          <option key={country.iso2} value={country.iso2}>
            {country.name}
          </option>
        ))}
      </select>
      <label className="label" htmlFor={`${id}-purpose`}>
        Why?
      </label>
      <select
        id={`${id}-purpose`}
        name="purpose"
        className="input"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        {...fieldProblem(state, 'purpose', messageId)}
      >
        <option value="" disabled>
          Choose a Purpose
        </option>
        {purposes.map((group) => (
          <optgroup key={group.family} label={group.label}>
            {group.options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <TravellerChecklist
        legend="Who's Travelling?"
        travellers={travellers}
        state={state}
        messageId={messageId}
        initial={[]}
      />
      <p className="muted u-fs-085 u-m-0">
        Each traveller keeps their own case, documents and privacy. Nothing is shared between
        travellers unless you choose it.
      </p>
      <div>
        <SubmitButton pending={pending} idle="Start Group Trip" busy="Starting…" />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}

/** Add Travellers: more of the account holder's own travellers, each with their own case. */
export function AddTravellersForm({
  tripId,
  travellers,
}: {
  readonly tripId: string;
  readonly travellers: readonly TripTravellerOption[];
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    addTravellersAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  return (
    <form ref={form} action={formAction} className="trip-add-form">
      <input type="hidden" name="tripId" value={tripId} />
      <TravellerChecklist
        // A new list of travellers (one added or removed) starts with nothing ticked.
        key={travellers.map((t) => t.applicantId).join(',')}
        legend="Who Else Is Travelling?"
        travellers={travellers}
        state={state}
        messageId={messageId}
        initial={[]}
      />
      <div>
        <SubmitButton pending={pending} idle="Add Travellers" busy="Adding…" />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}

/** Remove one traveller from the trip; their case stays exactly as it is. */
export function RemoveTravellerForm({
  tripId,
  applicantId,
  name,
}: {
  readonly tripId: string;
  readonly applicantId: string;
  readonly name: string;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    removeTravellerAction,
    NO_RESULT,
  );
  const id = useId();
  return (
    <form action={formAction} className="trip-inline-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="applicantId" value={applicantId} />
      <SubmitButton
        pending={pending}
        idle="Remove from Trip"
        busy="Removing…"
        className="btn btn-secondary"
        label={`Remove from Trip: ${name}`}
      />
      <FormMessage id={`${id}-msg`} result={state} />
    </form>
  );
}

/** Share one traveller's own travel document (a booking or itinerary) with the trip. */
export function AddTripEvidenceForm({
  tripId,
  documents,
}: {
  readonly tripId: string;
  readonly documents: readonly TripDocumentOption[];
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    addTripEvidenceAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  const hintId = `${id}-hint`;
  const [documentId, setDocumentId] = useState('');
  return (
    <form ref={form} action={formAction} className="trip-add-form">
      <input type="hidden" name="tripId" value={tripId} />
      <label className="label" htmlFor={`${id}-document`}>
        Travel Document
      </label>
      <select
        id={`${id}-document`}
        name="documentId"
        className="input"
        value={documentId}
        onChange={(e) => setDocumentId(e.target.value)}
        {...fieldProblem(state, 'documentId', messageId, hintId)}
      >
        <option value="" disabled>
          Choose a Document
        </option>
        {documents.map((d) => (
          <option key={d.documentId} value={d.documentId}>
            {d.label}
          </option>
        ))}
      </select>
      <p id={hintId} className="muted u-fs-085 u-m-0">
        Only bookings, itineraries, invitations and accommodation papers can be shared across a
        trip. Passports, bank papers and medical papers never are.
      </p>
      <div>
        <SubmitButton pending={pending} idle="Add to Trip" busy="Adding…" />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}

/** Allow, or stop allowing, one shared trip document to be used for one traveller. */
export function TripEvidenceAllowanceForm({
  tripId,
  evidenceId,
  applicantId,
  travellerName,
  documentName,
  allowed,
}: {
  readonly tripId: string;
  readonly evidenceId: string;
  readonly applicantId: string;
  readonly travellerName: string;
  readonly documentName: string;
  readonly allowed: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    tripEvidenceAllowanceAction,
    NO_RESULT,
  );
  const id = useId();
  const idle = allowed ? `Stop Using for ${travellerName}` : `Use for ${travellerName}`;
  return (
    <form action={formAction} className="trip-inline-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="allowed" value={allowed ? 'no' : 'yes'} />
      <SubmitButton
        pending={pending}
        idle={idle}
        busy="Saving…"
        className="btn btn-secondary"
        label={`${idle}: ${documentName}`}
      />
      <FormMessage id={`${id}-msg`} result={state} />
    </form>
  );
}

/** Stop sharing a document across the trip; it stays in its traveller's own documents. */
export function RemoveTripEvidenceForm({
  tripId,
  evidenceId,
  applicantId,
  documentName,
}: {
  readonly tripId: string;
  readonly evidenceId: string;
  readonly applicantId: string;
  readonly documentName: string;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    removeTripEvidenceAction,
    NO_RESULT,
  );
  const id = useId();
  return (
    <form action={formAction} className="trip-inline-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <input type="hidden" name="applicantId" value={applicantId} />
      <SubmitButton
        pending={pending}
        idle="Stop Sharing"
        busy="Saving…"
        className="btn btn-secondary"
        label={`Stop Sharing: ${documentName}`}
      />
      <FormMessage id={`${id}-msg`} result={state} />
    </form>
  );
}
