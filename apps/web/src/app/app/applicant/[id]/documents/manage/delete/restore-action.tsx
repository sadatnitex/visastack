'use client';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../../../i18n/app-applicant';
import type { ManageActionProps } from '../registry';
import { REMOVAL_WORDS as W, refusalNode } from '../removal-words';
import { restoreDeletedAction, restoreInfoAction } from './actions';
import { removedInLine } from './messages';

/**
 * Restore from Recently Deleted (lane LC-C). Says how long is left ("Removed in 12 Days"), then
 * brings the document back as it was. Cases that moved to the identical copy stay with that copy.
 */
export function RestoreDeletedAction({
  applicantId,
  documentId,
  documentName,
  onClose,
}: ManageActionProps) {
  const t = useT(appApplicantCatalog);
  const router = useRouter();
  const [days, setDays] = useState<number | null>(null);
  const [problem, setProblem] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  const load = useCallback(async () => {
    try {
      const info = await restoreInfoAction(applicantId, documentId);
      if (!info.ok) setProblem(refusalNode(t, info));
      else setDays(info.days);
    } catch {
      setProblem(t.node(W.couldNotCheckDocument));
    }
  }, [applicantId, documentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (root.current?.contains(document.activeElement)) return;
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'center' });
  }, []);

  useEffect(() => {
    if (done) heading.current?.focus();
  }, [done]);

  async function restore() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const restored = await restoreDeletedAction(applicantId, documentId, 'RECENTLY_DELETED');
      if (!restored.ok) {
        setProblem(refusalNode(t, restored));
        return;
      }
      setDone(true);
    } catch {
      setProblem(t.node(W.couldNotRestoreIt));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div ref={root} className="lc-delete" aria-labelledby={headingId}>
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-delete-heading">
          {t.node('appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.documentRestored')}
        </h3>
        <output className="lc-delete-result">
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.documentnameIsBackInYourDocuments',
            { documentName },
          )}
        </output>
        <div className="lc-delete-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              router.refresh();
            }}
          >
            {t.node('appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.done')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} className="lc-delete" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-delete-heading">
        {t.node(
          'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.restoreDocumentname',
          {
            documentName,
          },
        )}
      </h3>
      {problem ? (
        <p className="lc-delete-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {days === null && !problem ? (
        <output>
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.checkingThisDocument',
          )}
        </output>
      ) : null}
      {days !== null ? (
        <>
          <p>
            {t.node(
              'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.removedinlineRestoreItToBringIt',
              { removedInLine: removedInLine(days) },
            )}
          </p>
          <div className="lc-delete-actions">
            <button
              type="button"
              className="btn btn-primary"
              aria-disabled={busy || undefined}
              onClick={restore}
            >
              {busy
                ? t.node('appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.restoring')
                : t.node('appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.restore')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onClose();
              }}
            >
              {t.node('appApplicant.appApplicantIdDocumentSuggestionCard.cancel')}
            </button>
          </div>
        </>
      ) : (
        <div className="lc-delete-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.node('appApplicant.appApplicantIdDocumentsManageArchiveArchiveAction.close')}
          </button>
        </div>
      )}
    </div>
  );
}
