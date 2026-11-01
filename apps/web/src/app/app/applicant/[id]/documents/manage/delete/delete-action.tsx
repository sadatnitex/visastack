'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { UndoStatus } from '../../../../../../../components/lifecycle/undo-status';
import { formatTimestampDate } from '../../../../../../../lib/format-date';
import type { ManageActionProps } from '../registry';
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
 * seconds. The page is redrawn only when the person presses Done (or after Undo), so the result
 * is read before anything moves. Buttons stay focusable while work runs (aria-disabled).
 */
export function DeleteDuplicateAction({
  applicantId,
  documentId,
  documentName,
  onClose,
}: ManageActionProps) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletedDays, setDeletedDays] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  const load = useCallback(async () => {
    try {
      const loaded = await deletePreviewAction(applicantId, documentId);
      if (!loaded.ok) setProblem(loaded.message);
      else setPreview(loaded);
    } catch {
      setProblem('We could not check this copy. Close this and try again.');
    }
  }, [applicantId, documentId]);

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
        setProblem(deleted.message);
        return;
      }
      setDeletedDays(deleted.days);
      heading.current?.focus();
    } catch {
      setProblem('We could not delete it. Check your connection and try again.');
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
          Duplicate Deleted
        </h3>
        <UndoStatus
          message={deletedLine(deletedDays)}
          onUndo={undo}
          undoneMessage="Restored. The copy is back in your documents."
        />
        <div className="lc-delete-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              router.refresh();
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} className="lc-delete" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-delete-heading">
        Delete Duplicate?
      </h3>
      {problemLine}
      {!preview && !problem ? <output>Checking this copy</output> : null}
      {preview ? (
        <>
          <p>
            {documentName} is an exact copy. The identical copy that stays is{' '}
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
            It waits in Recently Deleted until {formatTimestampDate(preview.purgeAfter)}, and you
            can restore it until then. After that it is removed for good.
          </p>
          <div className="lc-delete-actions">
            <button
              type="button"
              className="btn btn-primary"
              aria-disabled={busy || undefined}
              onClick={remove}
            >
              {busy ? 'Deleting' : 'Delete Duplicate'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onClose();
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {problem && !preview ? (
        <div className="lc-delete-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
