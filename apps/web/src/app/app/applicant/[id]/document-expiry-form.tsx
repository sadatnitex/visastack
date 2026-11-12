'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import { type ActionState, setDocumentExpiryAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

interface DocumentExpiryFormProps {
  readonly applicantId: string;
  readonly documentId: string;
  /** Where the saved date came from: read from the document, entered by the person, or none yet. */
  readonly origin: 'NONE' | 'READ' | 'TYPED';
  /** The day the person typed (`YYYY-MM-DD`) and has not cleared, or null. */
  readonly typedOn: string | null;
  /** The person's typed date differs from the date read from the document. */
  readonly mismatch: boolean;
  /** The saved date, already written for reading ("30 Apr 2031"), or null. */
  readonly savedLabel: string | null;
  /** The typed date, already written for reading, or null. */
  readonly typedLabel: string | null;
}

/**
 * Set the expiry date of any document, in the person's own words. A date typed here is always
 * labelled as entered by the person, never as read from the document or confirmed by whoever
 * issued it. A date read from a passport is shown, never replaced: if the two differ, both are
 * shown and the person is asked to check. A date that has passed asks once, in plain words, before
 * it is saved, because the document then counts as expired for the person's cases.
 */
export function DocumentExpiryForm({
  applicantId,
  documentId,
  origin,
  typedOn,
  mismatch,
  savedLabel,
  typedLabel,
}: DocumentExpiryFormProps) {
  const t = useT(appApplicantCatalog);
  const [state, formAction, pending] = useActionState(setDocumentExpiryAction, INITIAL);
  const [typed, setTyped] = useState(typedOn ?? '');
  const [listedTyped, setListedTyped] = useState(typedOn);
  if (typedOn !== listedTyped) {
    // Follows the saved date after a refresh without starting the form again (see DocumentRenameForm).
    setListedTyped(typedOn);
    setTyped(typedOn ?? '');
  }
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const inputId = `${id}-expiry`;
  const hintId = `${id}-hint`;
  const messageId = `${id}-message`;
  useFocusInvalidField(formRef, state);

  const confirming = state.confirmPastDate !== undefined && state.confirmPastDate === typed;
  const idle = confirming
    ? 'Save Anyway'
    : typedOn === null
      ? 'Set Expiry Date'
      : 'Update Expiry Date';

  return (
    <form ref={formRef} action={formAction} className="field-stack" id={`expiry-${documentId}`}>
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="documentId" value={documentId} />
      {confirming ? (
        <input type="hidden" name="confirmPastDate" value={state.confirmPastDate} />
      ) : null}
      <label className="field-label" htmlFor={inputId}>
        {t('appApplicant.appApplicantIdDocumentExpiryForm.expiryDate')}
      </label>
      <p id={hintId} className="muted u-fs-075-m0">
        {origin === 'READ' && savedLabel
          ? t('appApplicant.appApplicantIdDocumentExpiryForm.savedlabelReadFromTheDocument', {
              savedLabel,
            })
          : origin === 'TYPED' && savedLabel
            ? t('appApplicant.appApplicantIdDocumentExpiryForm.savedlabelEnteredByYou', {
                savedLabel,
              })
            : t('appApplicant.appApplicantIdDocumentExpiryForm.noExpiryDateYetEnterThe')}
      </p>
      {mismatch && savedLabel && typedLabel ? (
        <p className="muted u-fs-075-m0">
          {t('appApplicant.appApplicantIdDocumentExpiryForm.youEnteredTypedlabelTheDocumentSays', {
            typedLabel,
            savedLabel,
          })}
        </p>
      ) : null}
      <div className="field-inline">
        <input
          id={inputId}
          name="expiresOn"
          type="date"
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
          className="input"
          {...fieldProblem(state, 'expiresOn', messageId, hintId)}
        />
        <SubmitButton pending={pending} idle={idle} busy="Saving…" className="btn btn-secondary" />
        {typedOn !== null ? (
          <SubmitButton
            pending={pending}
            idle="Clear My Date"
            busy="Saving…"
            className="btn btn-secondary"
            name="intent"
            value="clear"
          />
        ) : null}
      </div>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving the date." />
    </form>
  );
}
