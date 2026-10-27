'use client';

import { MAX_DOCUMENT_NAME_LENGTH } from '@visastack/core';
import { useActionState, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { type ActionState, renameDocumentAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

interface DocumentRenameFormProps {
  readonly applicantId: string;
  readonly documentId: string;
  /** The name it is listed under now. */
  readonly name: string;
}

/**
 * The name a document is listed under, which the person can change. A new document starts with
 * its automatic title ("Passport, Nazmus"); a name saved here replaces it everywhere.
 *
 * The form starts again whenever the listed name changes (a new automatic title after the kind is
 * chosen, or the saved name itself), so it always shows the current name. Until then the box keeps
 * what the person typed, including after a refused save, so nothing has to be typed twice.
 */
export function DocumentRenameForm(props: DocumentRenameFormProps) {
  return <RenameForm key={props.name} {...props} />;
}

function RenameForm({ applicantId, documentId, name }: DocumentRenameFormProps) {
  const [state, formAction, pending] = useActionState(renameDocumentAction, INITIAL);
  const [typed, setTyped] = useState(name);
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
          maxLength={MAX_DOCUMENT_NAME_LENGTH}
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
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
