'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { componentsShareCatalog } from '../../i18n/components-share';
import { type ShareMessage, whatsAppHref } from '../../lib/whatsapp-link';
import { useT } from '../i18n-provider';

const BLOCKED = 'Copying is blocked here. The message is selected: copy it with your keyboard.';

/**
 * Copy Message for any prepared text. Where the browser refuses the clipboard, the message appears
 * in a box already selected, and it is selected again on every further press (so the button never
 * looks dead). The result is announced through a polite live region that stays in the page.
 */
export function useCopyMessage(text: string): {
  button: ReactNode;
  notice: ReactNode;
  /** Puts another line (for example a sharing fault) in the same live region. */
  say: (line: string) => void;
} {
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');
  const [blocked, setBlocked] = useState(0);

  useEffect(() => {
    if (blocked === 0) return;
    field.current?.focus();
    field.current?.select();
  }, [blocked]);

  async function copy() {
    setStatus('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setBlocked(0);
      setStatus('Message copied. Paste it into any chat.');
    } catch {
      setBlocked((count) => count + 1);
      setStatus(BLOCKED);
    }
  }

  return {
    say: setStatus,
    button: (
      <button type="button" className="btn btn-secondary" onClick={copy}>
        Copy Message
      </button>
    ),
    notice: (
      <>
        {blocked > 0 ? (
          <div className="wa-share-manual">
            <label htmlFor={fieldId} className="field-label">
              Message to Copy
            </label>
            <textarea
              ref={field}
              id={fieldId}
              className="input"
              value={text}
              readOnly
              rows={Math.min(8, Math.ceil(text.length / 60) + 1)}
            />
          </div>
        ) : null}
        <output aria-live="polite" className="wa-share-status">
          {status}
        </output>
      </>
    ),
  };
}

/** Just Copy Message, for text that cannot be offered on WhatsApp. */
export function CopyMessageOnly({ text }: { readonly text: string }) {
  const copy = useCopyMessage(text);
  return (
    <div className="wa-share">
      <div className="action-row">{copy.button}</div>
      {copy.notice}
    </div>
  );
}

/**
 * The one way VisaStack offers "send this to someone" (owner decision, 10 Nov 2026). WhatsApp comes
 * first because it is where most people already are. It opens WhatsApp with the words ready and
 * VisaStack sends nothing: the person presses Send inside WhatsApp, and VisaStack cannot see
 * whether they did, so nothing here ever says it was sent.
 *
 * - Send on WhatsApp: a plain link to WhatsApp's own address. With a known number it opens that
 *   chat; otherwise it opens WhatsApp's own contact picker. It needs no script, so it works on a
 *   phone and on a computer.
 * - More Ways to Send: the phone's own share sheet, shown only where the browser has one.
 * - Copy Message: always there. If the browser refuses the clipboard the message is shown selected.
 *
 * `message` can only come from `composeShareMessage`, which keeps identifiers, dates of birth and
 * file links out. Extra buttons (for example Copy Link) go in as children and sit in the same row.
 */
export function WhatsAppShare({
  message,
  number,
  title = 'VisaStack',
  sendOnly = false,
  children,
}: {
  readonly message: ShareMessage;
  /** The recipient's number, only where this screen already shows it to this person. */
  readonly number?: string | null | undefined;
  /** The title the phone's share sheet shows. */
  readonly title?: string;
  /** Only the Send on WhatsApp link, for a short hello with nothing worth copying. */
  readonly sendOnly?: boolean;
  readonly children?: ReactNode;
}) {
  const t = useT(componentsShareCatalog);
  const [canShare, setCanShare] = useState(false);
  const copy = useCopyMessage(message.text);

  // Known only in the browser, so it is read after the first paint (no mismatch with the server).
  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  async function share() {
    copy.say('');
    try {
      await navigator.share({ title, text: message.text });
    } catch (error) {
      // Closing the share sheet is a choice, not a fault.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      copy.say('Sharing was closed. You can still copy the message.');
    }
  }

  return (
    <div className="wa-share">
      <div className="action-row">
        <a
          className="btn btn-secondary wa-share-send"
          href={whatsAppHref(message, number)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <WhatsAppIcon />
          Send on WhatsApp
          <span className="sr-only"> (opens WhatsApp)</span>
        </a>
        {canShare && !sendOnly ? (
          <button type="button" className="btn btn-secondary" onClick={share}>
            {t.node('componentsShare.shareWhatsappShare.moreWaysToSend')}
          </button>
        ) : null}
        {sendOnly ? null : copy.button}
        {children}
      </div>
      {copy.notice}
    </div>
  );
}

/** The WhatsApp mark, small and decorative: the words beside it carry the meaning. */
function WhatsAppIcon() {
  return (
    <svg
      className="wa-share-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.39-1.48a8.97 8.97 0 0 1-1.65-2.06c-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.08-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41Z"
      />
    </svg>
  );
}
