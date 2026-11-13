'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useT } from '../../../../../../../components/i18n-provider';
import { UndoStatus } from '../../../../../../../components/lifecycle/undo-status';
import { appApplicantCatalog } from '../../../../../../../i18n/app-applicant';
import { formatTimestampDate } from '../../../../../../../lib/format-date';
import type { ManageActionProps } from '../registry';
import { REMOVAL_WORDS as W, refusalNode } from '../removal-words';
import {
  type DeletePreviewResult,
  deleteDuplicateAction,
  deletePreviewAction,
  restoreDeletedAction,
} from './actions';
import { casesLine, deletedLine } from './messages';

type Preview = Extract<DeletePreviewResult, { ok: true }>;

/**
 * Delete Duplicate (lane LC-C), opened from the Manage menu. One confirmation that names the copy
 * that stays and the open cases that will switch to it, then a status line with Undo for ten
 * seconds. This panel does not redraw the page itself until Done or Undo, but a page that is
 * still refreshing for a file being checked can move the copy to Recently Deleted sooner and
 * close it: the line therefore also says where to restore it from. Buttons stay focusable while
 * work runs (aria-disabled).
 */
export function DeleteDuplicateAction({
  applicantId,
  documentId,
  documentName,
  onClose,
}: ManageActionProps) {
  const t = useT(appApplicantCatalog);
  const locale = useLocale();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [deletedDays, setDeletedDays] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  const load = useCallback(async () => {
    try {
      const loaded = await deletePreviewAction(applicantId, documentId);
      if (!loaded.ok) setProblem(refusalNode(t, loaded));
      else setPreview(loaded);
    } catch {
      setProblem(t.node(W.couldNotCheckCopy));
    }
  }, [applicantId, documentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opened from a reminder's link, nothing has focus here yet: take it and come into view.
  useEffect(() => {
    if (root.current?.contains(document.activeElement)) return;
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'center' });
  }, []);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const deleted = await deleteDuplicateAction(applicantId, documentId);
      if (!deleted.ok) {
        setProblem(refusalNode(t, deleted));
        return;
      }
      setDeletedDays(deleted.days);
      heading.current?.focus();
    } catch {
      setProblem(t.node(W.couldNotDeleteIt));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    const restored = await restoreDeletedAction(applicantId, documentId, 'UNDO');
    if (!restored.ok) throw new Error(restored.message);
    router.refresh();
  }

  const problemLine = problem ? (
    <p className="lc-delete-problem" role="alert">
      {problem}
    </p>
  ) : null;

  if (deletedDays !== null) {
    return (
      <div ref={root} className="lc-delete" aria-labelledby={headingId}>
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-delete-heading">
          {t.node('appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.duplicateDeleted')}
        </h3>
        <UndoStatus
          message={deletedLine(deletedDays)}
          onUndo={undo}
          undoneMessage="Restored. The copy is back in your documents."
        />
        <p className="lc-delete-note">
          You can restore it from Recently Deleted until then. Each removal is listed in your{' '}
          <Link href={`/app/applicant/${applicantId}/removal-records`}>Removal Records</Link>.
        </p>
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
        {t.node('appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.deleteDuplicate')}
      </h3>
      {problemLine}
      {!preview && !problem ? (
        <output>
          {t.node('appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.checkingThisCopy')}
        </output>
      ) : null}
      {preview ? (
        <>
          <p>
            {t.node(
              'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.documentnameIsAnExactCopyThe',
              { documentName },
            )}{' '}
            <strong>{preview.survivorName}</strong>.
          </p>
          <p>{casesLine(preview.cases.length)}</p>
          {preview.cases.length > 0 ? (
            <ul className="lc-delete-cases">
              {preview.cases.map((c) => (
                <li key={c.missionId}>{c.title}</li>
              ))}
            </ul>
          ) : null}
          <p className="lc-delete-note">
            {t.node(
              'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.itWaitsInRecentlyDeletedUntil',
              { formatTimestampDate: formatTimestampDate(preview.purgeAfter, locale) },
            )}
          </p>
          <div className="lc-delete-actions">
            <button
              type="button"
              className="btn btn-primary"
              aria-disabled={busy || undefined}
              onClick={remove}
            >
              {busy
                ? t.node('appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.deleting')
                : t.node(
                    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.deleteDuplicate484f53',
                  )}
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
      ) : null}
      {problem && !preview ? (
        <div className="lc-delete-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.node('appApplicant.appApplicantIdDocumentsManageArchiveArchiveAction.close')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
