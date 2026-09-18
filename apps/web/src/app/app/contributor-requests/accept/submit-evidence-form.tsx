'use client';

import { useActionState } from 'react';
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

  if (state.ok && state.message) {
    return <p className="field-msg field-msg-ok">{state.message}</p>;
  }

  return (
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
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
        <input type="checkbox" name="allowWalletReuse" value="true" />
        Also allow this document to be reused for the traveller's future cases (optional - off by
        default, this file only helps with this one case)
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Uploading…' : 'Submit document'}
      </button>
      {state.message ? <p className="field-msg field-msg-err">{state.message}</p> : null}
      <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
        PNG, JPEG, DOCX, TXT or MD · scanned for safety on upload.
      </p>
    </form>
  );
}
