'use client';

import { useActionState, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { type ActionState, renameDocumentAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** The longest name a person can give a document (the service's MAX_DOCUMENT_NAME_LENGTH). */
const MAX_NAME_LENGTH = 200;

/**
 * The name a document is listed under, which the person can change. A new document starts with
 * its automatic title ("Passport, Nazmus"); a name saved here replaces it everywhere.
 */
export function DocumentRenameForm({
  applicantId,
  documentId,
  name,
}: {
  readonly applicantId: string;
  readonly documentId: string;
  /** The name it is listed under now. */
  readonly name: string;
}) {
  const [state, formAction, pending] = useActionState(renameDocumentAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = `name-${documentId}`;
  const messageId = `name-msg-${documentId}`;
  useFocusInvalidField(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="field-stack">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="documentId" value={documentId} />
      <label className="field-label" htmlFor={inputId}>
        Document Name
      </label>
      <div className="field-inline">
        <input
          id={inputId}
          name="name"
          type="text"
          required
          maxLength={MAX_NAME_LENGTH}
          defaultValue={name}
          className="input"
          autoComplete="off"
          {...fieldProblem(state, 'name', messageId)}
        />
        <SubmitButton pending={pending} idle="Save" busy="Saving…" className="btn btn-secondary" />
      </div>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving the name." />
    </form>
  );
}
