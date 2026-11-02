'use client';

import { useId, useRef, useState } from 'react';

/** The neutral words shared with a link: never the route, the documents or the person. */
export function whatsAppShareUrl(url: string): string {
  const message = `Your agency has asked you for documents through VisaStack. Open this private link: ${url}`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * A private request link, shown once. Copy puts it on the clipboard; Share on WhatsApp opens
 * WhatsApp with a message ready to send. VisaStack sends nothing through WhatsApp and cannot see
 * whether it was sent, so nothing here ever says it was.
 */
export function CollectionLinkPanel({ url }: { readonly url: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Link copied. Share it privately with the person.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage('Select and copy the link above, then share it privately.');
    }
  }
  return (
    <div className="field-list u-mt-100 collection-link-panel">
      <label htmlFor={id} className="field-label">
        Private Request Link
      </label>
      <input ref={input} id={id} className="input" value={url} readOnly />
      <div className="action-row">
        <button type="button" className="btn btn-secondary" onClick={copy}>
          Copy Link
        </button>
        <a
          className="btn btn-secondary"
          href={whatsAppShareUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on WhatsApp
        </a>
      </div>
      <p className="muted">
        This link is shown only once. Opening WhatsApp prepares a message; you choose whether to
        send it, and VisaStack cannot see whether it was sent. Revoking the request stops the link.
      </p>
      <output aria-live="polite">{message}</output>
    </div>
  );
}
