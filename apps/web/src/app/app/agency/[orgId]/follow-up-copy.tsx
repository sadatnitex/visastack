'use client';

import { useId } from 'react';
import { useT } from '../../../../components/i18n-provider';
import { useShareMessage } from '../../../../components/share/use-share-message';
import { CopyMessageOnly, WhatsAppShare } from '../../../../components/share/whatsapp-share';
import { appAgencyCatalog } from '../../../../i18n/app-agency';

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
  const t = useT(appAgencyCatalog);
  const id = useId();
  const shareMessage = useShareMessage({ template: 'prepared-text', text });

  return (
    <>
      {shareMessage ? (
        <WhatsAppShare
          message={shareMessage}
          title={t('appAgency.appAgencyOrgidFollowUpCopy.followUp')}
        />
      ) : null}
      <details className="do-next-follow-up">
        <summary className="do-next-follow-up-toggle">{summary}</summary>
        <div className="do-next-follow-up-body">
          {agencyNoteLeftOut ? (
            <p className="do-next-follow-up-hint">
              {t('appAgency.appAgencyOrgidFollowUpCopy.yourNoteWasLeftOutBecause')}
            </p>
          ) : null}
          <label htmlFor={id} className="field-label">
            {t('appAgency.appAgencyOrgidFollowUpCopy.messageToCopy')}
          </label>
          <textarea
            id={id}
            className="input do-next-follow-up-text"
            value={text}
            readOnly
            rows={Math.min(14, text.split('\n').length + 1)}
          />
          <p className="muted do-next-follow-up-note">
            {t('appAgency.appAgencyOrgidFollowUpCopy.readItFirstItIsNot')}
          </p>
          {shareMessage ? null : <CopyMessageOnly text={text} />}
        </div>
      </details>
    </>
  );
}
