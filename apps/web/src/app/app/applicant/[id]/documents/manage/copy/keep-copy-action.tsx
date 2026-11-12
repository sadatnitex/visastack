'use client';
import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';
import { FormMessage, SubmitButton } from '../../../../../../../components/form-feedback';
import { useT } from '../../../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../../../i18n/app-applicant';
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
  const t = useT(appApplicantCatalog);
  const [state, action, pending] = useActionState(keepCopyAction, INITIAL);
  const closeButton = useRef<HTMLButtonElement>(null);
  // The form goes once the copy is kept, taking the focused button with it: focus moves to Close
  // so the keyboard carries on from here, and the message below stays where it was so it is read.
  useEffect(() => {
    if (state.ok) closeButton.current?.focus();
  }, [state.ok]);
  const only = copyPeople.length === 1 ? copyPeople[0] : undefined;
  if (copyPeople.length === 0) {
    return (
      <div className="lc-action">
        <p>
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.thereIsNoOneElseOn',
          )}
        </p>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.node('appApplicant.appApplicantIdDocumentsManageArchiveArchiveAction.close')}
        </button>
      </div>
    );
  }
  return (
    <div className="lc-action">
      {state.ok ? null : (
        <form action={action}>
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
              <legend>
                {t.node(
                  'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.keepACopyOfDocumentnameFor',
                  { documentName },
                )}
              </legend>
              {copyPeople.map((person) => (
                <label key={person.id} className="umpe-g1-person-choice">
                  <input type="radio" name="targetId" value={person.id} required />
                  <span>{person.name}</span>
                </label>
              ))}
            </fieldset>
          )}
          <p className="muted">
            {t.node(
              'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.itIsASeparateCopyChecked',
            )}
          </p>
          <div className="upload-drop-actions">
            <SubmitButton
              pending={pending}
              idle="Keep a Copy"
              busy="Saving"
              label={
                only
                  ? t(
                      'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.keepACopyForName',
                      { name: only.name },
                    )
                  : t('appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.keepACopy')
              }
            />
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t.node('appApplicant.appApplicantIdDocumentSuggestionCard.cancel')}
            </button>
          </div>
        </form>
      )}
      <FormMessage result={state} pending={pending} pendingText="Saving" />
      {state.ok ? (
        <div className="upload-drop-actions">
          {state.targetId ? (
            <Link className="btn btn-secondary" href={`/app/applicant/${state.targetId}/documents`}>
              {t.node(
                'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.openTheirDocuments',
              )}
            </Link>
          ) : null}
          <button ref={closeButton} type="button" className="btn btn-secondary" onClick={onClose}>
            {t.node('appApplicant.appApplicantIdDocumentsManageArchiveArchiveAction.close')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
