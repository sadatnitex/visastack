'use client';

import { useId, useRef, useState } from 'react';
import { useT } from '../../../../../components/i18n-provider';
import { useShareMessage } from '../../../../../components/share/use-share-message';
import { WhatsAppShare } from '../../../../../components/share/whatsapp-share';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';

/**
 * A private request link, shown once. Send on WhatsApp opens WhatsApp with a message ready; Copy
 * Link puts the bare link on the clipboard. VisaStack sends nothing through WhatsApp and cannot see
 * whether it was sent, so nothing here ever says it was.
 */
export function CollectionLinkPanel({ url }: { readonly url: string }) {
  const t = useT(appAgencyCatalog);
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
      {t('appAgency.appAgencyOrgidCollectionCollectionLinkPanel.copyLink')}
    </button>
  );
  return (
    <div className="field-list u-mt-100 collection-link-panel">
      <label htmlFor={id} className="field-label">
        {t('appAgency.appAgencyOrgidCollectionCollectionLinkPanel.privateRequestLink')}
      </label>
      <input ref={input} id={id} className="input" value={url} readOnly />
      {shareMessage ? (
        <WhatsAppShare
          message={shareMessage}
          title={t('appAgency.appAgencyOrgidCollectionCollectionLinkPanel.visastackRequest')}
        >
          {copyLink}
        </WhatsAppShare>
      ) : (
        <div className="action-row">{copyLink}</div>
      )}
      <p className="muted">
        {t('appAgency.appAgencyOrgidCollectionCollectionLinkPanel.thisLinkIsShownOnlyOnce')}
      </p>
      <output aria-live="polite">{status}</output>
    </div>
  );
}
