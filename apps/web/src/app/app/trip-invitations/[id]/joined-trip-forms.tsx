'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FieldError,
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import {
  choosePaperAction,
  leaveTripAction,
  planOwnCaseAction,
  removePaperAction,
  setShareLevelAction,
} from './actions';

/** One level a companion may share, with the one plain line that says what the organiser then sees. */
export interface ShareChoice {
  readonly value: string;
  readonly label: string;
  readonly line: string;
}

/** One of the companion's own papers: its name and kind in plain words. */
export interface PaperChoice {
  readonly documentId: string;
  readonly name: string;
  readonly kind: string;
}

/**
 * What You Share with the Organiser: the three levels, one line each, the current one chosen. It is
 * the companion's choice alone and takes effect on the organiser's next read.
 */
export function ShareLevelForm({
  tripId,
  current,
  choices,
}: {
  readonly tripId: string;
  readonly current: string;
  readonly choices: readonly ShareChoice[];
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    setShareLevelAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  return (
    <form ref={form} action={action} className="companion-accept-form">
      <input type="hidden" name="tripId" value={tripId} />
      <fieldset className="companion-share">
        <legend className="label">What You Share with the Organiser</legend>
        {choices.map((item) => (
          <label key={item.value} className="companion-choice">
            <input
              type="radio"
              name="shareLevel"
              value={item.value}
              defaultChecked={item.value === current}
              {...fieldProblem(state, 'shareLevel', messageId)}
            />
            <span>
              <span className="companion-choice-label">{item.label}</span>
              <span className="muted u-fs-085">{item.line}</span>
            </span>
          </label>
        ))}
        <FieldError result={state} field="shareLevel" />
      </fieldset>
      <div className="companion-actions">
        <SubmitButton pending={pending} idle="Save" busy="Saving…" />
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

/** Plan My Own Case for This Trip: one filled button. Their own case, on their own account. */
export function PlanOwnCaseForm({ tripId }: { readonly tripId: string }) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    planOwnCaseAction,
    NO_RESULT,
  );
  const id = useId();
  return (
    <form action={action} className="companion-decline-form">
      <input type="hidden" name="tripId" value={tripId} />
      <SubmitButton pending={pending} idle="Plan My Own Case for This Trip" busy="Starting…" />
      <FormMessage id={`${id}-msg`} result={state} />
    </form>
  );
}

/** Leave This Trip: a quiet button that asks once, because the organiser stops seeing the person. */
export function LeaveTripForm({ tripId }: { readonly tripId: string }) {
  const [state, action, pending] = useActionState<FormResult, FormData>(leaveTripAction, NO_RESULT);
  const id = useId();
  const [asking, setAsking] = useState(false);
  return (
    <form action={action} className="trip-inline-form">
      <input type="hidden" name="tripId" value={tripId} />
      {asking ? (
        <>
          <span className="muted u-fs-085">
            Leave this trip? The organiser will no longer see you.
          </span>
          <SubmitButton
            pending={pending}
            idle="Yes, Leave This Trip"
            busy="Leaving…"
            className="btn btn-secondary"
          />
          <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>
            Stay
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => setAsking(true)}>
          Leave This Trip
        </button>
      )}
      <FormMessage id={`${id}-msg`} result={state} />
    </form>
  );
}

/** Stop showing one paper. */
export function RemovePaperForm({
  tripId,
  paper,
}: {
  readonly tripId: string;
  readonly paper: PaperChoice;
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    removePaperAction,
    NO_RESULT,
  );
  const id = useId();
  return (
    <form action={action} className="trip-inline-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="documentId" value={paper.documentId} />
      <SubmitButton
        pending={pending}
        idle="Remove"
        busy="Removing…"
        className="btn btn-secondary"
        label={`Remove: ${paper.name}`}
      />
      <FormMessage id={`${id}-msg`} result={state} />
    </form>
  );
}

/** Show one more of their own papers, by name only. */
export function ChoosePaperForm({
  tripId,
  options,
}: {
  readonly tripId: string;
  readonly options: readonly PaperChoice[];
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    choosePaperAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  return (
    <form ref={form} action={action} className="trip-add-form">
      <input type="hidden" name="tripId" value={tripId} />
      <label className="label" htmlFor={`${id}-paper`}>
        Paper to Show
      </label>
      <select
        id={`${id}-paper`}
        name="documentId"
        className="input"
        required
        defaultValue=""
        {...fieldProblem(state, 'documentId', messageId)}
      >
        <option value="" disabled>
          Choose a Paper
        </option>
        {options.map((paper) => (
          <option key={paper.documentId} value={paper.documentId}>
            {paper.name} ({paper.kind})
          </option>
        ))}
      </select>
      <FieldError result={state} field="documentId" />
      <div className="companion-actions">
        <SubmitButton
          pending={pending}
          idle="Show This Paper"
          busy="Adding…"
          className="btn btn-secondary"
        />
      </div>
      <FormMessage id={messageId} result={state} visuallyHidden />
    </form>
  );
}
