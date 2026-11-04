'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../../../components/form-feedback';
import type { ManageActionProps } from '../registry';
import { type KeepCopyState, keepCopyAction } from './actions';

const INITIAL: KeepCopyState = { ok: false, message: '' };

/**
 * Also Keep a Copy for Another Person (a marriage certificate, a joint account statement). One
 * choice of person and one button; it says plainly that the copy is separate, so removing one
 * never removes the other, and that it is checked for safety first like any new file. With one
 * other person there is nothing to choose, only a question to answer.
 */
export function KeepCopyAction({
  applicantId,
  documentId,
  documentName,
  copyPeople = [],
  onClose,
}: ManageActionProps) {
  const [state, action, pending] = useActionState(keepCopyAction, INITIAL);
  const only = copyPeople.length === 1 ? copyPeople[0] : undefined;
  if (copyPeople.length === 0) {
    return (
      <div className="lc-action">
        <p>There is no one else on your account to keep a copy for.</p>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  if (state.ok) {
    return (
      <div className="lc-action">
        <p role="status">{state.message}</p>
        <div className="upload-drop-actions">
          {state.targetId ? (
            <Link className="btn btn-secondary" href={`/app/applicant/${state.targetId}/documents`}>
              Open Their Documents
            </Link>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="lc-action">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="documentId" value={documentId} />
      {only ? (
        <>
          <input type="hidden" name="targetId" value={only.id} />
          <p>
            Keep a copy of <strong>{documentName}</strong> for <strong>{only.name}</strong>?
          </p>
        </>
      ) : (
        <fieldset className="umpe-g1-person-choices">
          <legend>Keep a Copy of {documentName} for Whom?</legend>
          {copyPeople.map((person) => (
            <label key={person.id} className="umpe-g1-person-choice">
              <input type="radio" name="targetId" value={person.id} required />
              <span>{person.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="muted">
        It is a separate copy, checked for safety like any new file. Removing one does not remove
        the other.
      </p>
      <div className="upload-drop-actions">
        <SubmitButton
          pending={pending}
          idle="Keep a Copy"
          busy="Saving"
          label={only ? `Keep a Copy for ${only.name}` : 'Keep a Copy'}
        />
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
      <FormMessage result={state} pending={pending} pendingText="Saving" />
    </form>
  );
}
