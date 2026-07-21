'use client';

import { useActionState } from 'react';
import { type ActionState, uploadDocumentAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function DocumentUploader({ applicantId }: { readonly applicantId: string }) {
  const [state, formAction, pending] = useActionState(uploadDocumentAction, INITIAL);

  return (
    <form action={formAction} className="uploader">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input
        name="file"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf"
        required
        className="input"
        aria-label="Document file"
      />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Uploading…' : 'Upload document'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
      <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
        PDF, PNG or JPEG · up to 15 MB · scanned for safety on upload.
      </p>
    </form>
  );
}
