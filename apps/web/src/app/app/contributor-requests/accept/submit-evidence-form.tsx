'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, submitContributorEvidenceAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function SubmitEvidenceForm({
  token,
  docType,
}: {
  readonly token: string;
  readonly docType: string;
}) {
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
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
          >
            <input type="checkbox" name="allowWalletReuse" value="true" />
            Also allow this document to be reused for the traveller's future cases (optional - off
            by default, this file only helps with this one case)
          </label>
          <SubmitButton
            pending={pending}
            idle="Submit document"
            busy="Uploading…"
            className="btn btn-primary"
          />
          <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
            PDF, PNG, JPEG, DOCX, TXT or MD · scanned for safety on upload.
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
