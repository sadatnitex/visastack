'use client';

import { useId, useRef, useState } from 'react';
import type { ShareInput } from '../lib/whatsapp-link';
import { useShareMessage } from './share/use-share-message';
import { WhatsAppShare } from './share/whatsapp-share';

/** Who the invitation is for decides the words WhatsApp is given. */
export type InvitationPurpose = 'client' | 'team' | 'sharing';

function shareInputFor(purpose: InvitationPurpose, link: string): ShareInput {
  if (purpose === 'client') return { template: 'client-invitation', link };
  if (purpose === 'team') return { template: 'team-invitation', link };
  return { template: 'sharing-invitation', link };
}

export function InvitationLink({
  url,
  purpose,
}: {
  readonly url: string;
  readonly purpose: InvitationPurpose;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Link copied. Share it privately with your invitee.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setStatus('Select and copy the link above, then share it privately.');
    }
  }
  const shareMessage = useShareMessage(shareInputFor(purpose, url));
  const copyLink = (
    <button type="button" className="btn btn-secondary" onClick={copy}>
      Copy Link
    </button>
  );
  return (
    <div className="field-list u-mt-100">
      <label htmlFor={id} className="field-label">
        Private Invitation Link
      </label>
      <input ref={input} id={id} className="input" value={url} readOnly />
      {shareMessage ? (
        <WhatsAppShare message={shareMessage} title="VisaStack Invitation">
          {copyLink}
        </WhatsAppShare>
      ) : (
        <div className="action-row">{copyLink}</div>
      )}
      <p className="muted">
        Share only with your invitee. Revoking the invitation stops this link from working.
      </p>
      <output aria-live="polite">{status}</output>
    </div>
  );
}
