'use client';

import { useActionState, useId, useState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../components/form-feedback';
import { Icon } from '../../../../../components/icons';
import { AboutDisclosure } from '../../../../../components/ui-lift';
import { SAVING_TEXT, saveResult } from '../../../../../lib/save-status';
import { type ActionState, submitEvidenceResponseAction } from './actions';
import { type DocumentChoice, chooseLegendId, initialChoice } from './response-choices';

const INITIAL: ActionState = { ok: true, message: '' };

interface CandidateFact {
  readonly factId: string;
  readonly value: string;
}

/** Said under the choices, in the one place each sentence is kept. */
const HINT_ONLY_ONE =
  'This is the only one that fits, so it is already chosen. Check it, then send.';
const HINT_CHOOSE = 'Choose which one to send.';
const HINT_SENT_BACK =
  'The copy the agency sent back is marked. Choose another, or upload a clearer copy.';
/** The full wording of what sending does, kept whole under "About Sending". */
export const CONSENT_LINE =
  'Sending lets the agency download this exact copy while it has access to your records. Later changes to the file are not sent.';
/** The one short sentence that stays beside the Send button (the 30-word rule, 5 Nov 2026). */
export const CONSENT_SHORT = 'Sending shares this exact copy.';

/**
 * The applicant's side of Commercial V1 Part 4 §10: pick a fact or a document they already hold
 * (explicit wallet reuse) and send it as the response.
 *
 * A document is chosen by name, kind, the moment it was added and how it was checked, so two copies
 * never look the same. A file that cannot be sent yet is shown, not selectable, with the plain
 * reason beside it. The exact file version the person saw is posted with the choice, so the agency
 * receives that copy and no other. A fresh retry key is made on the server for each render, so
 * pressing Send twice answers with the first send instead of making a second.
 *
 * It says what happened to the change, truthfully (spec B09): Saving while the server works, Saved
 * at a time only once the server confirmed it, and Not saved with the reason and a Try Again button
 * when it did not. The request leaves the waiting list as soon as it is saved, so the form stays
 * mounted with `awaiting` false and keeps showing "Saved at" instead of vanishing with the answer
 * it confirms.
 *
 * Anticipate, never decide (CCD section 6): when exactly one finished copy fits, and it is not the
 * copy the agency just sent back, it is chosen and the form says so; otherwise nothing is chosen
 * until the person picks. Nothing is ever sent without the button.
 */
export function SubmitResponseForm({
  applicantId,
  requestId,
  kind,
  candidateFacts,
  documentChoices,
  documentsRead = true,
  idempotencyKey,
  exactCopies = false,
  awaiting = true,
  timeZone = null,
  itemLabel,
}: {
  readonly applicantId: string;
  readonly requestId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly candidateFacts: readonly CandidateFact[];
  readonly documentChoices: readonly DocumentChoice[];
  /** False when the documents could not be read: nothing is offered and the person is told so. */
  readonly documentsRead?: boolean;
  /** Made on the server for this render (24 random characters); never made in the browser. */
  readonly idempotencyKey: string;
  /** The service keeps the exact copy that is sent (migration 0132 has run). */
  readonly exactCopies?: boolean;
  /** False once the request no longer waits on the traveller: only the confirmation stays. */
  readonly awaiting?: boolean;
  /** The traveller's own time zone, for the "Saved at" time. */
  readonly timeZone?: string | null;
  /** What the request is for, so several Send buttons on one page each say which item they send. */
  readonly itemLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(submitEvidenceResponseAction, INITIAL);
  const onlyFact = candidateFacts.length === 1 ? (candidateFacts[0]?.factId ?? '') : '';
  // What is chosen before the person does anything: one fitting item that was not just sent back.
  const [initial] = useState(kind === 'FIELD' ? onlyFact : initialChoice(documentChoices));
  const [selection, setSelection] = useState(initial);
  const hintId = useId();
  const result = saveResult(state, timeZone);
  // While the request waits on the person, a success can only be about an earlier round (the
  // agency sent it back after it was saved): "Saved at" is shown once the request has left the
  // waiting list, and never beside a fresh Send button.
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
  if (kind === 'DOCUMENT' && !documentsRead) {
    return (
      <p className="notice notice-warn u-m-0" role="alert">
        Your documents could not be loaded. Refresh to try again.
      </p>
    );
  }
  if (kind === 'DOCUMENT' && documentChoices.length === 0) {
    return (
      <div className="request-response">
        <p className="muted u-fs-085 u-m-0">
          No copy of this document type can be sent right now. Add it in Documents, then come back
          to send it.
        </p>
        <div className="request-response-actions">
          <a className="btn btn-secondary" href={`/app/applicant/${applicantId}/documents`}>
            Open Documents
          </a>
        </div>
      </div>
    );
  }

  const chosen = documentChoices.find((choice) => choice.documentId === selection);
  const sentBackShown = kind === 'DOCUMENT' && documentChoices.some((choice) => choice.sentBack);
  const somethingToChoose =
    kind === 'FIELD' ? candidateFacts.length > 0 : documentChoices.some((choice) => choice.usable);
  // The hint follows what is chosen now, so it stays true if the list changes later.
  const hint =
    selection !== '' && selection === initial
      ? HINT_ONLY_ONE
      : sentBackShown
        ? HINT_SENT_BACK
        : selection === '' && somethingToChoose
          ? HINT_CHOOSE
          : null;

  return (
    <form action={formAction} className="request-response lc-response">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name={kind === 'FIELD' ? 'factId' : 'documentId'} value={selection} />
      {kind === 'DOCUMENT' && exactCopies && chosen ? (
        <input type="hidden" name="documentVersionId" value={chosen.versionId} />
      ) : null}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset className="request-choices" aria-describedby={hint ? hintId : undefined}>
        <legend
          className="evidence-pick-legend lc-pick-legend"
          id={chooseLegendId(requestId)}
          tabIndex={-1}
        >
          {kind === 'FIELD' ? 'Choose the Detail to Send' : 'Choose the Copy to Send'}
        </legend>
        {kind === 'FIELD'
          ? candidateFacts.map((f) => (
              <label key={f.factId} className="request-choice lc-choice">
                <input
                  type="radio"
                  name="choice"
                  checked={selection === f.factId}
                  onChange={() => setSelection(f.factId)}
                />
                {f.value}
              </label>
            ))
          : documentChoices.map((choice) => (
              <label
                key={choice.documentId}
                className={`request-choice evidence-pick lc-choice lc-pick${choice.usable ? '' : ' request-choice-unavailable lc-choice-unavailable'}`}
              >
                <input
                  type="radio"
                  name="choice"
                  disabled={!choice.usable}
                  checked={selection === choice.documentId}
                  onChange={() => setSelection(choice.documentId)}
                />
                <span className="lc-pick-icon" aria-hidden="true">
                  <Icon name="file" size={20} />
                </span>
                <span className="evidence-pick-text">
                  <span className="evidence-pick-name lc-pick-name">{choice.name}</span>
                  <span className="evidence-pick-meta">
                    {choice.kindLabel} · Added {choice.addedLabel} · {choice.scanLabel}
                  </span>
                  {choice.sentBack ? (
                    <span className="evidence-pick-tag evidence-pick-tag-warn">
                      Sent Back by the Agency
                    </span>
                  ) : choice.newest ? (
                    <span className="evidence-pick-tag">Newest</span>
                  ) : null}
                  {!choice.usable ? (
                    <span className="evidence-pick-meta">{choice.scanDetail}</span>
                  ) : null}
                </span>
              </label>
            ))}
      </fieldset>
      <div className="request-response-actions lc-response-actions">
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
      {kind === 'DOCUMENT' && exactCopies ? (
        <p className="muted u-fs-085 u-m-0">{CONSENT_SHORT}</p>
      ) : null}
      {hint || (kind === 'DOCUMENT' && exactCopies) ? (
        <AboutDisclosure summary="About Sending">
          {hint ? (
            <p className="muted u-fs-085 u-m-0" id={hintId}>
              {hint}
            </p>
          ) : null}
          {kind === 'DOCUMENT' && exactCopies ? (
            <p className="muted u-fs-085 u-m-0">{CONSENT_LINE}</p>
          ) : null}
        </AboutDisclosure>
      ) : null}
    </form>
  );
}
