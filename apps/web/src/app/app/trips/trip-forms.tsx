'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { CountryField } from '../../../components/country-field';
import {
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../components/form-feedback';
import { PurposeSelect } from '../../../components/purpose-select';
import { AboutDisclosure } from '../../../components/ui-lift';
import type { CaseCountryOption, CasePurposeGroup } from '../../../lib/case-choices';
import { AUTHORITY_SENTENCE } from '../add-applicant-form';
import {
  addTravellersAction,
  addTripEvidenceAction,
  removeCompanionAction,
  removeTravellerAction,
  removeTripEvidenceAction,
  resendCompanionAction,
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

/**
 * The ticked travellers, kept by the form so a refused try keeps what was chosen and a family
 * member made a moment ago can be ticked for the person.
 */
function useChosenTravellers(created: string | undefined) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (applicantId: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(applicantId);
      else next.delete(applicantId);
      return next;
    });
  useEffect(() => {
    if (created) setChosen((prev) => new Set(prev).add(created));
  }, [created]);
  return { chosen, toggle };
}

/** The ticked-travellers list, controlled by the form that owns it. */
function TravellerChecklist({
  legend,
  travellers,
  state,
  messageId,
  chosen,
  onToggle,
}: {
  readonly legend: string;
  readonly travellers: readonly TripTravellerOption[];
  readonly state: FormResult;
  readonly messageId: string;
  readonly chosen: ReadonlySet<string>;
  readonly onToggle: (applicantId: string, on: boolean) => void;
}) {
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
            onChange={(e) => onToggle(t.applicantId, e.target.checked)}
            {...(index === 0 ? fieldProblem(state, 'traveller', messageId) : {})}
          />
          <span>{t.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * An optional section that opens in place: its button is replaced by the fields, so focus moves to
 * the first field when it opens and back to the button when it closes (the section the person
 * pressed has just gone). The first render moves nothing.
 */
function useOpenSection(open: boolean, onOpenChange: (open: boolean) => void) {
  const nameRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    (open ? nameRef.current : toggleRef.current)?.focus();
  }, [open]);
  const show = (next: boolean) => {
    moved.current = true;
    onOpenChange(next);
  };
  return { nameRef, toggleRef, show };
}

/**
 * Add a Family Member, inside the trip form: a name, how they are related, and the authority
 * confirmation the Home form asks for. The fields exist only while the section is open, so a
 * closed section sends nothing. The person is made with the trip, on this account, with their own
 * case; nothing is shared and no account is made for them.
 */
function FamilyMemberFields({
  state,
  messageId,
  created,
  open,
  onOpenChange,
}: {
  readonly state: FormResult;
  readonly messageId: string;
  readonly created: string | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { nameRef, toggleRef, show } = useOpenSection(open, onOpenChange);
  const [kind, setKind] = useState<'FAMILY_MEMBER' | 'MINOR_GUARDIAN'>('FAMILY_MEMBER');
  const id = useId();
  // Once the person exists the section closes: their name is in the list above, ticked.
  useEffect(() => {
    if (created) onOpenChange(false);
  }, [created, onOpenChange]);
  if (!open) {
    return (
      <button
        ref={toggleRef}
        type="button"
        className="btn btn-secondary trip-member-toggle"
        aria-expanded={false}
        onClick={() => show(true)}
      >
        Add a Family Member
      </button>
    );
  }
  return (
    <fieldset className="trip-member-fields">
      <legend className="label">Add a Family Member</legend>
      <label className="label" htmlFor={`${id}-name`}>
        Name as on the Passport
      </label>
      <input
        ref={nameRef}
        id={`${id}-name`}
        name="newName"
        required
        maxLength={120}
        autoComplete="off"
        className="input"
        {...fieldProblem(state, 'newName', messageId)}
      />
      <fieldset className="trip-member-kind">
        <legend className="label">Relationship</legend>
        <label className="package-check">
          <input
            type="radio"
            name="newKind"
            value="FAMILY_MEMBER"
            checked={kind === 'FAMILY_MEMBER'}
            onChange={() => setKind('FAMILY_MEMBER')}
            {...fieldProblem(state, 'newKind', messageId)}
          />
          <span>Family Member</span>
        </label>
        <label className="package-check">
          <input
            type="radio"
            name="newKind"
            value="MINOR_GUARDIAN"
            checked={kind === 'MINOR_GUARDIAN'}
            onChange={() => setKind('MINOR_GUARDIAN')}
          />
          <span>Minor (Guardian)</span>
        </label>
      </fieldset>
      <label className="package-check">
        <input
          type="checkbox"
          name="newAuthority"
          value="true"
          required
          {...fieldProblem(state, 'newAuthority', messageId)}
        />
        <span>{AUTHORITY_SENTENCE}</span>
      </label>
      <button type="button" className="btn btn-secondary" onClick={() => show(false)}>
        Cancel
      </button>
    </fieldset>
  );
}

/**
 * Add Someone Else, inside the trip form: a friend or colleague who is not one of the account
 * holder's own people. A name, and an email if they have one. The fields exist only while the
 * section is open, so a closed section sends nothing. The person is added after the trip exists;
 * nothing of theirs is made and no email address is ever shown back.
 */
function SomeoneElseFields({
  state,
  messageId,
  open,
  onOpenChange,
}: {
  readonly state: FormResult;
  readonly messageId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { nameRef, toggleRef, show } = useOpenSection(open, onOpenChange);
  const id = useId();
  if (!open) {
    return (
      <button
        ref={toggleRef}
        type="button"
        className="btn btn-secondary trip-member-toggle"
        aria-expanded={false}
        onClick={() => show(true)}
      >
        Add Someone Else
      </button>
    );
  }
  const hintId = `${id}-hint`;
  return (
    <fieldset className="trip-member-fields">
      <legend className="label">Add Someone Else</legend>
      <p id={hintId} className="muted u-fs-085 u-m-0">
        With an email, they are invited to join and choose what to share with you.
      </p>
      <label className="label" htmlFor={`${id}-name`}>
        Name
      </label>
      <input
        ref={nameRef}
        id={`${id}-name`}
        name="newPersonName"
        required
        maxLength={120}
        autoComplete="off"
        className="input"
        {...fieldProblem(state, 'newPersonName', messageId, hintId)}
      />
      <label className="label" htmlFor={`${id}-email`}>
        Email
      </label>
      <input
        id={`${id}-email`}
        name="newPersonEmail"
        type="email"
        autoComplete="off"
        className="input"
        {...fieldProblem(state, 'newPersonEmail', messageId, hintId)}
      />
      <button type="button" className="btn btn-secondary" onClick={() => show(false)}>
        Cancel
      </button>
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
  companionsOn = false,
}: {
  readonly countries: readonly CaseCountryOption[];
  readonly purposes: readonly CasePurposeGroup[];
  readonly travellers: readonly TripTravellerOption[];
  /** Whether adding someone else is on. Decided by the page on the server; off (or missing) hides it. */
  readonly companionsOn?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    startGroupTripAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  const [purpose, setPurpose] = useState('');
  const { chosen, toggle } = useChosenTravellers(state.created);
  const [adding, setAdding] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  return (
    <form ref={form} action={formAction} className="trip-start-form">
      <label className="label" htmlFor={`${id}-destination`}>
        Where Are You Going?
      </label>
      <CountryField
        id={`${id}-destination`}
        countries={countries}
        placeholder="For example: Japan"
        hint="Type a name or open the list."
        problem={fieldProblem(state, 'destination', messageId)}
      />
      <label className="label" htmlFor={`${id}-purpose`}>
        Why?
      </label>
      <PurposeSelect
        id={`${id}-purpose`}
        purposes={purposes}
        value={purpose}
        onChange={setPurpose}
        {...fieldProblem(state, 'purpose', messageId)}
      />
      <TravellerChecklist
        legend="Who's Travelling?"
        travellers={travellers}
        state={state}
        messageId={messageId}
        chosen={chosen}
        onToggle={toggle}
      />
      <div className="trip-add-more">
        <FamilyMemberFields
          state={state}
          messageId={messageId}
          created={state.created}
          open={adding}
          onOpenChange={setAdding}
        />
        {companionsOn ? (
          <SomeoneElseFields
            state={state}
            messageId={messageId}
            open={addingPerson}
            onOpenChange={setAddingPerson}
          />
        ) : null}
      </div>
      <AboutDisclosure summary="About This">
        <p className="muted u-fs-085 u-m-0">
          Each traveller keeps their own case, documents and privacy. Nothing is shared between
          travellers unless you choose it.
        </p>
      </AboutDisclosure>
      <div>
        <SubmitButton pending={pending} idle="Start Group Trip" busy="Starting…" />
        <FormMessage id={messageId} result={state} />
      </div>
    </form>
  );
}

/**
 * Add Travellers: more of the account holder's own people, each with their own case, or a family
 * member added right here. When everyone they manage is already on the trip, the form is the
 * family member section alone.
 */
export function AddTravellersForm({
  tripId,
  travellers,
  companionsOn = false,
}: {
  readonly tripId: string;
  readonly travellers: readonly TripTravellerOption[];
  /** Whether adding someone else is on. Decided by the page on the server; off (or missing) hides it. */
  readonly companionsOn?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    addTravellersAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  const { chosen, toggle } = useChosenTravellers(state.created);
  const [adding, setAdding] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const nobodyToTick = travellers.length === 0;
  const personOpen = companionsOn && addingPerson;
  // With nobody to tick, the button names whatever is being added right now.
  const onlyIdle =
    adding && personOpen ? 'Add People' : personOpen ? 'Add Someone Else' : 'Add Family Member';
  return (
    <form ref={form} action={formAction} className="trip-add-form">
      <input type="hidden" name="tripId" value={tripId} />
      {travellers.length > 0 ? (
        <TravellerChecklist
          legend="Who Else Is Travelling?"
          travellers={travellers}
          state={state}
          messageId={messageId}
          chosen={chosen}
          onToggle={toggle}
        />
      ) : (
        <p className="u-m-0">Everyone you manage is already on this trip.</p>
      )}
      <div className="trip-add-more">
        <FamilyMemberFields
          state={state}
          messageId={messageId}
          created={state.created}
          open={adding}
          onOpenChange={setAdding}
        />
        {companionsOn ? (
          <SomeoneElseFields
            state={state}
            messageId={messageId}
            open={addingPerson}
            onOpenChange={setAddingPerson}
          />
        ) : null}
      </div>
      <div>
        {nobodyToTick && !adding && !personOpen ? null : (
          <SubmitButton
            pending={pending}
            idle={nobodyToTick ? onlyIdle : 'Add Travellers'}
            busy="Adding…"
          />
        )}
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

/** Send an invitation again to someone who has not joined; the old link stops working. */
export function ResendCompanionForm({
  tripId,
  companionId,
  name,
}: {
  readonly tripId: string;
  readonly companionId: string;
  readonly name: string;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    resendCompanionAction,
    NO_RESULT,
  );
  const id = useId();
  return (
    <form action={formAction} className="trip-inline-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="companionId" value={companionId} />
      <SubmitButton
        pending={pending}
        idle="Send Again"
        busy="Sending…"
        className="btn btn-secondary"
        label={`Send Again: ${name}`}
      />
      <FormMessage id={`${id}-msg`} result={state} />
    </form>
  );
}

/** Take someone off the trip. Their own case, if they started one, stays theirs. */
export function RemoveCompanionForm({
  tripId,
  companionId,
  name,
}: {
  readonly tripId: string;
  readonly companionId: string;
  readonly name: string;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    removeCompanionAction,
    NO_RESULT,
  );
  const id = useId();
  // Taking someone off ends their access and discards what they chose to share, and cannot be
  // undone from here, so it asks once.
  const [asking, setAsking] = useState(false);
  return (
    <form action={formAction} className="trip-inline-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="companionId" value={companionId} />
      {asking ? (
        <>
          <span className="muted u-fs-085">Remove {name}? They lose access at once.</span>
          <SubmitButton
            pending={pending}
            idle="Yes, Remove"
            busy="Removing…"
            className="btn btn-secondary"
            label={`Yes, Remove: ${name}`}
          />
          <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>
            Keep
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          aria-label={`Remove: ${name}`}
          onClick={() => setAsking(true)}
        >
          Remove
        </button>
      )}
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
  // The row already names the traveller and says Allowed or Not Allowed, so the button says only
  // what it does; its spoken name keeps the traveller and the document.
  const idle = allowed ? 'Stop Using' : 'Use';
  const spoken = `${idle} for ${travellerName}`;
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
        label={`${spoken}: ${documentName}`}
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
