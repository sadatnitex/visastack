'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { usePageLanguage, useT } from '../../../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../../../i18n/app-applicant';
import type { ManageActionProps } from '../registry';
import { type RefusalLine, REMOVAL_WORDS as W, refusalNode, said } from '../removal-words';
import { cancelRemovalRequestAction } from './actions';

/**
 * Removal Requested, with Cancel Request (lane LC-D). Shown from the Manage menu while support
 * has not decided: the person sees that the request is waiting and can withdraw it.
 */
export function CancelRemovalRequestAction({
  applicantId,
  documentId,
  documentName,
  onClose,
}: ManageActionProps) {
  const t = useT(appApplicantCatalog);
  const pageLang = usePageLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<RefusalLine | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

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

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const done = await cancelRemovalRequestAction(applicantId, documentId);
      if (done.ok) setResult(done.message);
      else setProblem(done);
    } catch {
      setProblem(said(W.requestCancelFailed));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div ref={root} className="lc-request">
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-request-heading">
          {t.node('appApplicant.appApplicantIdDocumentsManageRequestCancelAction.requestCancelled')}
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
        {t.node('appApplicant.appApplicantIdDocumentsManageRequestCancelAction.removalRequested')}
      </h3>
      <p className="lc-request-note">
        {t.node(
          'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.youAskedUsToRemoveDocumentname',
          { documentName },
        )}
      </p>
      {problem ? (
        <p className="lc-request-problem" role="alert">
          {refusalNode(t, problem, pageLang)}
        </p>
      ) : null}
      <div className="lc-request-actions">
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={busy || undefined}
          onClick={cancel}
        >
          {busy
            ? t.node('appApplicant.appApplicantIdDocumentsManageRequestCancelAction.cancelling')
            : t.node('appApplicant.appApplicantIdDocumentsManageRequestCancelAction.cancelRequest')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.node('appApplicant.appApplicantIdDocumentsManageRequestCancelAction.keepRequest')}
        </button>
      </div>
    </div>
  );
}
