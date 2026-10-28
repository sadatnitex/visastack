'use client';

import { useActionState, useState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../components/form-feedback';
import { SAVING_TEXT, saveResult } from '../../../../../lib/save-status';
import { type ActionState, submitEvidenceResponseAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

interface CandidateFact {
  readonly factId: string;
  readonly value: string;
}

interface CandidateDocument {
  readonly documentId: string;
  readonly displayName: string;
  readonly usable: boolean;
  readonly statusLabel: string;
}

/**
 * The applicant's side of Commercial V1 Part 4 §10: pick a fact/document
 * they already hold (explicit wallet reuse; no separate upload flow is
 * forced here) and submit it as the response. A document that has not
 * finished safety processing, or failed it, is shown but not selectable:
 * `submitEvidenceResponse` would refuse it server-side regardless, but
 * disabling it here is honest about why, rather than letting the applicant
 * hit an error for a reason the UI never explained.
 *
 * It says what happened to the change, truthfully (spec B09): Saving while
 * the server works, Saved at a time only once the server confirmed it, and
 * Not saved with the reason and a Try Again button when it did not. The
 * request leaves the waiting list as soon as it is saved, so the form stays
 * mounted with `awaiting` false and keeps showing "Saved at" instead of
 * vanishing with the answer it confirms.
 *
 * Anticipate, never decide (CCD section 6): when exactly one finished item fits, it is chosen
 * and the form says so; with more than one, nothing is chosen until the person picks. Nothing is
 * ever sent without the button.
 */
export function SubmitResponseForm({
  applicantId,
  requestId,
  kind,
  candidateFacts,
  candidateDocuments,
  awaiting = true,
  timeZone = null,
  itemLabel,
}: {
  readonly applicantId: string;
  readonly requestId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly candidateFacts: readonly CandidateFact[];
  readonly candidateDocuments: readonly CandidateDocument[];
  /** False once the request no longer waits on the traveller: only the confirmation stays. */
  readonly awaiting?: boolean;
  /** The traveller's own time zone, for the "Saved at" time. */
  readonly timeZone?: string | null;
  /** What the request is for, so several Submit buttons on one page each say which item they send. */
  readonly itemLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(submitEvidenceResponseAction, INITIAL);
  const usableDocuments = candidateDocuments.filter((d) => d.usable);
  const choices =
    kind === 'FIELD'
      ? candidateFacts.map((f) => f.factId)
      : usableDocuments.map((d) => d.documentId);
  const onlyChoice = choices.length === 1 ? (choices[0] ?? '') : '';
  const [selection, setSelection] = useState(onlyChoice);
  const result = saveResult(state, timeZone);
  // While the request waits on the person, a success can only be about an earlier round (the
  // agency sent it back after it was saved): "Saved at" is shown once the request has left the
  // waiting list, and never beside a fresh Submit button.
  const waitingResult = state.ok ? NO_RESULT : result;

  if (!awaiting) {
    return state.ok && state.savedAt ? (
      <div className="request-response">
        <FormMessage result={result} />
      </div>
    ) : null;
  }

  if (kind === 'FIELD' && candidateFacts.length === 0) {
    return (
      <p className="muted u-fs-085">
        You have not recorded this field yet. Add it on your{' '}
        <a href={`/app/applicant/${applicantId}/profile`}>profile</a> first, then come back to
        submit it.
      </p>
    );
  }
  if (kind === 'DOCUMENT' && candidateDocuments.length === 0) {
    return (
      <p className="muted u-fs-085">
        You have not uploaded this document type yet. Upload it on your{' '}
        <a href={`/app/applicant/${applicantId}/documents`}>documents</a> page first, then come back
        to submit it.
      </p>
    );
  }

  return (
    <form action={formAction} className="request-response">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name={kind === 'FIELD' ? 'factId' : 'documentId'} value={selection} />
      <fieldset className="request-choices">
        <legend className="sr-only">
          {kind === 'FIELD' ? 'Choose the Detail to Send' : 'Choose the Document to Send'}
        </legend>
        {kind === 'FIELD'
          ? candidateFacts.map((f) => (
              <label key={f.factId} className="request-choice">
                <input
                  type="radio"
                  name="choice"
                  checked={selection === f.factId}
                  onChange={() => setSelection(f.factId)}
                />
                {f.value}
              </label>
            ))
          : candidateDocuments.map((d) => (
              <label
                key={d.documentId}
                className={`request-choice${d.usable ? '' : ' request-choice-unavailable'}`}
              >
                <input
                  type="radio"
                  name="choice"
                  disabled={!d.usable}
                  checked={selection === d.documentId}
                  onChange={() => setSelection(d.documentId)}
                />
                {d.displayName}
                {!d.usable ? (
                  <span className="muted u-fs-075">
                    ({d.statusLabel.toLowerCase()}, not ready yet)
                  </span>
                ) : null}
              </label>
            ))}
      </fieldset>
      {choices.length === 1 ? (
        <p className="muted u-fs-085">
          This is the only one that fits, so it is already chosen. Check it, then send.
        </p>
      ) : choices.length > 1 ? (
        <p className="muted u-fs-085">Choose which one to send.</p>
      ) : null}
      <div className="request-response-actions">
        <SubmitButton
          pending={pending}
          unavailable={selection.length === 0}
          idle={state.ok ? 'Send to the Agency' : 'Try Again'}
          {...(itemLabel
            ? { label: `${state.ok ? 'Send to the Agency' : 'Try Again'} ${itemLabel}` }
            : {})}
          busy="Sending…"
          className="btn btn-primary"
        />
        <FormMessage result={waitingResult} pending={pending} pendingText={SAVING_TEXT} />
      </div>
    </form>
  );
}
