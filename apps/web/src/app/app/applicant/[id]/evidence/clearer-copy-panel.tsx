'use client';

import { useState } from 'react';
import { useT } from '../../../../../components/i18n-provider';
import { applicantEvidenceCatalog } from '../../../../../i18n/applicant-evidence';
import { ReplaceAction } from '../documents/manage/replace/replace-action';
import { chooseLegendId } from './response-choices';

/**
 * Upload a Clearer Copy, inside the request the agency sent back (Lane E). It opens the same
 * Replace with a Newer Document steps the Documents page uses, started from the copy the agency
 * sent back, so the file is added, checked and filed as the same kind, the old copy stays in the
 * person's records marked Replaced, and anything already sent stays exactly as it was.
 *
 * The steps are mounted only while the panel is open: a closed panel reads nothing and takes no
 * focus. It never sends anything. When the steps finish, the list above shows the new copy and the
 * person chooses it and presses Send to the Agency themselves. Focus then moves to the choices
 * heading.
 */
export function ClearerCopyPanel({
  applicantId,
  requestId,
  documentId,
  documentName,
  primary = false,
}: {
  readonly applicantId: string;
  readonly requestId: string;
  /** The copy the agency sent back: the one the newer file replaces. */
  readonly documentId: string;
  readonly documentName: string;
  /** No other copy can be sent, so this is the way forward and reads as the main action. */
  readonly primary?: boolean;
}) {
  const t = useT(applicantEvidenceCatalog);
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
    // After the page has taken the new list, the person is back at the choices.
    setTimeout(() => document.getElementById(chooseLegendId(requestId))?.focus(), 0);
  }

  return (
    <details
      className="evidence-clearer"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        className={`evidence-clearer-toggle lc-clearer${primary ? ' evidence-clearer-primary lc-clearer-primary' : ''}`}
      >
        {t('applicantEvidence.appApplicantIdEvidenceClearerCopyPanel.uploadAClearerCopy')}
        <span className="sr-only">: {documentName}</span>
      </summary>
      {open ? (
        <ReplaceAction
          applicantId={applicantId}
          documentId={documentId}
          documentName={documentName}
          onClose={close}
        />
      ) : null}
    </details>
  );
}
