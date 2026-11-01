'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { ManageActionProps } from '../registry';
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
  const router = useRouter();
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
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
      setProblem('Choose a reason from the list.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const sent = await requestRemovalAction(applicantId, documentId, reason);
      if (sent.ok) setResult(sent.message);
      else setProblem(sent.message);
    } catch {
      setProblem('The request could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div ref={root} className="lc-request">
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-request-heading">
          Removal Requested
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
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} className="lc-request">
      <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-request-heading">
        Ask Us to Remove This File
      </h3>
      <p id={hintId} className="lc-request-note">
        {WHAT_HAPPENS}
      </p>
      <p className="lc-request-note">
        <strong>What Removed Means:</strong> {BACKUP_NOTE}
      </p>
      <fieldset
        className="lc-request-choices"
        aria-describedby={problem ? `${hintId} ${problemId}` : hintId}
      >
        <legend className="lc-request-legend">Why should we remove {documentName}?</legend>
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
          {problem}
        </p>
      ) : null}
      <div className="lc-request-actions">
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={busy || undefined}
          onClick={send}
        >
          {busy ? 'Sending' : 'Send Request'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
