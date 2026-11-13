'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { usePageLanguage, useT } from '../../../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../../../i18n/app-applicant';
import type { ManageActionProps } from '../registry';
import { type RefusalLine, REMOVAL_WORDS as W, refusalNode, said } from '../removal-words';
import { requestRemovalAction } from './actions';
import { BACKUP_NOTE, REASON_CHOICES, WHAT_HAPPENS } from './messages';

/**
 * Ask Us to Remove This File (lane LC-D), opened from the Manage menu. The person picks a reason
 * from a list (nothing is typed, so no personal detail is stored), reads what approval does, and
 * sends the request. Focus moves to the result heading so a keyboard or screen reader user hears
 * the outcome; buttons stay focusable while the request is sent (aria-disabled).
 */
export function RequestRemovalAction({
  applicantId,
  documentId,
  documentName,
  onClose,
}: ManageActionProps) {
  const t = useT(appApplicantCatalog);
  const pageLang = usePageLanguage();
  const router = useRouter();
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<RefusalLine | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const hintId = useId();
  const problemId = useId();

  useEffect(() => {
    if (result) heading.current?.focus();
  }, [result]);

  // Opened straight from a link (?manage=&action=), nothing has focus here yet: take it and come
  // into view. Opened from the Manage menu, the menu has already moved focus into the panel.
  useEffect(() => {
    if (root.current?.contains(document.activeElement)) return;
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'center' });
  }, []);

  const send = async () => {
    if (busy) return;
    if (!reason) {
      setProblem(said(W.chooseReasonFromList));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const sent = await requestRemovalAction(applicantId, documentId, reason);
      if (sent.ok) setResult(sent.message);
      else setProblem(sent);
    } catch {
      setProblem(said(W.requestSendFailed));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div ref={root} className="lc-request">
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-request-heading">
          {t.node('appApplicant.appApplicantIdDocumentsManageRequestCancelAction.removalRequested')}
        </h3>
        <output className="lc-request-result">{result}</output>
        <div className="lc-request-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              router.refresh();
            }}
          >
            {t.node('appApplicant.appApplicantIdDocumentsManageRequestCancelAction.done')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} className="lc-request">
      <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-request-heading">
        {t.node(
          'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.askUsToRemoveThisFile',
        )}
      </h3>
      <p id={hintId} className="lc-request-note">
        {WHAT_HAPPENS}
      </p>
      <p className="lc-request-note">
        <strong>
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.whatRemovedMeans',
          )}
        </strong>{' '}
        {BACKUP_NOTE}
      </p>
      <fieldset
        className="lc-request-choices"
        aria-describedby={problem ? `${hintId} ${problemId}` : hintId}
      >
        <legend className="lc-request-legend">
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.whyShouldWeRemoveDocumentname',
            { documentName },
          )}
        </legend>
        {REASON_CHOICES.map((choice) => (
          <label key={choice.value} className="lc-request-choice">
            <input
              type="radio"
              name={`removal-reason-${documentId}`}
              value={choice.value}
              checked={reason === choice.value}
              onChange={() => {
                setReason(choice.value);
                setProblem(null);
              }}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </fieldset>
      {problem ? (
        <p id={problemId} className="lc-request-problem" role="alert">
          {refusalNode(t, problem, pageLang)}
        </p>
      ) : null}
      <div className="lc-request-actions">
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={busy || undefined}
          onClick={send}
        >
          {busy
            ? t.node('appApplicant.appApplicantIdDocumentsManageRequestRequestAction.sending')
            : t.node('appApplicant.appApplicantIdDocumentsManageRequestRequestAction.sendRequest')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.node('appApplicant.appApplicantIdDocumentsManageRequestRequestAction.cancel')}
        </button>
      </div>
    </div>
  );
}
