'use client';

import { useId, useRef, useState } from 'react';
import { useShareMessage } from '../../../../../components/share/use-share-message';
import { WhatsAppShare } from '../../../../../components/share/whatsapp-share';

/**
 * A private request link, shown once. Send on WhatsApp opens WhatsApp with a message ready; Copy
 * Link puts the bare link on the clipboard. VisaStack sends nothing through WhatsApp and cannot see
 * whether it was sent, so nothing here ever says it was.
 */
export function CollectionLinkPanel({ url }: { readonly url: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const shareMessage = useShareMessage({ template: 'collection-link', link: url });
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Link copied. Share it privately with the person.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setStatus('Select and copy the link above, then share it privately.');
    }
  }
  const copyLink = (
    <button type="button" className="btn btn-secondary" onClick={copy}>
      Copy Link
    </button>
  );
  return (
    <div className="field-list u-mt-100 collection-link-panel">
      <label htmlFor={id} className="field-label">
        Private Request Link
      </label>
      <input ref={input} id={id} className="input" value={url} readOnly />
      {shareMessage ? (
        <WhatsAppShare message={shareMessage} title="VisaStack Request">
          {copyLink}
        </WhatsAppShare>
      ) : (
        <div className="action-row">{copyLink}</div>
      )}
      <p className="muted">
        This link is shown only once. Opening WhatsApp prepares a message; you choose whether to
        send it, and VisaStack cannot see whether it was sent. Revoking the request stops the link.
      </p>
      <output aria-live="polite">{status}</output>
    </div>
  );
}
