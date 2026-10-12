'use client';

import { useId, useRef, useState } from 'react';

export function InvitationLink({ url }: { readonly url: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Link copied. Share it privately with your invitee.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage('Select and copy the link above, then share it privately.');
    }
  }
  async function share() {
    if (!navigator.share) return copy();
    try {
      await navigator.share({
        title: 'VisaStack invitation',
        text: 'Review your invitation on VisaStack. Create an account or sign in, then follow the instructions.',
        url,
      });
    } catch {
      setMessage('Sharing was closed. You can still copy the link.');
    }
  }
  return (
    <div className="field-list" style={{ marginTop: '1rem' }}>
      <label htmlFor={id} className="field-label">
        Private invitation link
      </label>
      <input ref={input} id={id} className="input" value={url} readOnly />
      <div className="action-row">
        <button type="button" className="btn btn-secondary" onClick={copy}>
          Copy link
        </button>
        <button type="button" className="btn btn-secondary" onClick={share}>
          Share link
        </button>
      </div>
      <p className="muted">
        Share only with your invitee. Revoking the invitation stops this link from working.
      </p>
      <output aria-live="polite">{message}</output>
    </div>
  );
}
