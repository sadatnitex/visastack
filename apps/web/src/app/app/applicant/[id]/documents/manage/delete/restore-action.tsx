'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ManageActionProps } from '../registry';
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
  const router = useRouter();
  const [days, setDays] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  const load = useCallback(async () => {
    try {
      const info = await restoreInfoAction(applicantId, documentId);
      if (!info.ok) setProblem(info.message);
      else setDays(info.days);
    } catch {
      setProblem('We could not check this document. Close this and try again.');
    }
  }, [applicantId, documentId]);

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
        setProblem(restored.message);
        return;
      }
      setDone(true);
    } catch {
      setProblem('We could not restore it. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div ref={root} className="lc-delete" aria-labelledby={headingId}>
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-delete-heading">
          Document Restored
        </h3>
        <output className="lc-delete-result">
          {documentName} is back in your documents. Cases that moved to the identical copy stay with
          that copy.
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
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} className="lc-delete" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-delete-heading">
        Restore {documentName}?
      </h3>
      {problem ? (
        <p className="lc-delete-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {days === null && !problem ? <output>Checking this document</output> : null}
      {days !== null ? (
        <>
          <p>
            {removedInLine(days)}. Restore it to bring it back to your documents. Cases that moved
            to the identical copy stay with that copy.
          </p>
          <div className="lc-delete-actions">
            <button
              type="button"
              className="btn btn-primary"
              aria-disabled={busy || undefined}
              onClick={restore}
            >
              {busy ? 'Restoring' : 'Restore'}
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
      ) : (
        <div className="lc-delete-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
