'use client';

import { useId } from 'react';
import { useShareMessage } from '../../../../components/share/use-share-message';
import { CopyMessageOnly, WhatsAppShare } from '../../../../components/share/whatsapp-share';

/**
 * Shows a prepared follow-up message for the agency to read. Send on WhatsApp comes first and opens
 * WhatsApp with the same words; Copy Message is the fallback. Nothing is sent from here: the agency
 * presses Send in WhatsApp or pastes the text into its own email. The text is always on screen
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
  const shareMessage = useShareMessage({ template: 'prepared-text', text });

  return (
    <>
      {shareMessage ? <WhatsAppShare message={shareMessage} title="Follow-Up" /> : null}
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
            id={id}
            className="input do-next-follow-up-text"
            value={text}
            readOnly
            rows={Math.min(14, text.split('\n').length + 1)}
          />
          <p className="muted do-next-follow-up-note">
            Read it first. It is not sent for you: send it from WhatsApp, or paste it into your own
            email or message.
          </p>
          {shareMessage ? null : <CopyMessageOnly text={text} />}
        </div>
      </details>
    </>
  );
}
