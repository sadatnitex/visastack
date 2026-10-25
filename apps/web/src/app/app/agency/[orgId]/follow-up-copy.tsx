'use client';

import { useId, useRef, useState } from 'react';

/**
 * Shows a prepared follow-up message for the agency to read, and copies it on request. Nothing is
 * sent from here: the agency pastes it into its own email or chat. The text is always on screen
 * and selectable, so when the browser refuses the clipboard the person can copy it by hand; the
 * result is announced through a polite live region.
 */
export function FollowUpCopy({
  text,
  agencyNoteLeftOut,
  summary = 'Review Follow-Up Message',
}: {
  readonly text: string;
  readonly agencyNoteLeftOut: boolean;
  readonly summary?: string;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');

  function selectForManualCopy() {
    field.current?.focus();
    field.current?.select();
    setStatus('Copying is blocked here. The message is selected: copy it with your keyboard.');
  }

  async function copy() {
    setStatus('');
    if (!navigator.clipboard?.writeText) {
      selectForManualCopy();
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
    } catch {
      selectForManualCopy();
    }
  }

  return (
    <details className="do-next-follow-up">
      <summary className="do-next-follow-up-toggle">{summary}</summary>
      <div className="do-next-follow-up-body">
        {agencyNoteLeftOut ? (
          <p className="do-next-follow-up-hint">
            Your note was left out because it has a link, an email address or a long number. The
            standard wording is used instead.
          </p>
        ) : null}
        <label htmlFor={id} className="field-label">
          Message to Copy
        </label>
        <textarea
          ref={field}
          id={id}
          className="input do-next-follow-up-text"
          value={text}
          readOnly
          rows={Math.min(14, text.split('\n').length + 1)}
        />
        <p className="muted do-next-follow-up-note">
          Read it first. It is not sent for you: paste it into your own email or message.
        </p>
        <div className="action-row">
          <button type="button" className="btn btn-secondary" onClick={copy}>
            Copy Message
          </button>
        </div>
        <output aria-live="polite" className="do-next-follow-up-status">
          {status}
        </output>
      </div>
    </details>
  );
}
