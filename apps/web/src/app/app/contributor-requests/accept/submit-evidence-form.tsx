'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appContributorRequestsCatalog } from '../../../../i18n/app-contributor-requests';
import { type ActionState, submitContributorEvidenceAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function SubmitEvidenceForm({
  token,
  docType,
}: {
  readonly token: string;
  readonly docType: string;
}) {
  const t = useT(appContributorRequestsCatalog);
  const [state, formAction, pending] = useActionState(submitContributorEvidenceAction, INITIAL);

  // Once the document is in, the form gives way to the confirmation. The message region is
  // always in the page, so the confirmation is announced rather than appearing unannounced.
  const done = state.ok && state.message !== '';

  return (
    <>
      {done ? null : (
        <form action={formAction} className="uploader">
          <input type="hidden" name="token" value={token} />
          <input
            name="file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.docx,.txt,.md,image/png,image/jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            required
            className="input"
            aria-label={docType}
          />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: 'var(--text-small)',
            }}
          >
            <input type="checkbox" name="allowWalletReuse" value="true" />
            {t.node(
              'appContributorRequests.appContributorRequestsAcceptSubmitEvidenceForm.alsoAllowThisDocumentToBe',
            )}
          </label>
          <SubmitButton
            pending={pending}
            idle="Submit Document"
            busy="Uploading…"
            className="btn btn-primary"
          />
          <p className="muted" style={{ fontSize: 'var(--text-small)', margin: 0 }}>
            {t.node(
              'appContributorRequests.appContributorRequestsAcceptSubmitEvidenceForm.pdfPngJpegDocxTxtOr',
            )}
          </p>
        </form>
      )}
      <FormMessage
        result={state}
        pending={pending}
        pendingText="Uploading. This can take a minute."
      />
    </>
  );
}
