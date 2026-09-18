'use client';

import { useActionState, useState } from 'react';
import { type ActionState, submitEvidenceResponseAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

interface CandidateFact {
  readonly factId: string;
  readonly value: string;
}

interface CandidateDocument {
  readonly documentId: string;
  readonly displayName: string;
  readonly usable: boolean;
  readonly statusLabel: string;
}

/**
 * The applicant's side of Commercial V1 Part 4 §10: pick a fact/document
 * they already hold (explicit wallet reuse; no separate upload flow is
 * forced here) and submit it as the response. A document that has not
 * finished safety processing, or failed it, is shown but not selectable:
 * `submitEvidenceResponse` would refuse it server-side regardless, but
 * disabling it here is honest about why, rather than letting the applicant
 * hit an error for a reason the UI never explained.
 */
export function SubmitResponseForm({
  applicantId,
  requestId,
  kind,
  candidateFacts,
  candidateDocuments,
}: {
  readonly applicantId: string;
  readonly requestId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly candidateFacts: readonly CandidateFact[];
  readonly candidateDocuments: readonly CandidateDocument[];
}) {
  const [state, formAction, pending] = useActionState(submitEvidenceResponseAction, INITIAL);
  const usableDocuments = candidateDocuments.filter((d) => d.usable);
  const [selection, setSelection] = useState(
    kind === 'FIELD' ? (candidateFacts[0]?.factId ?? '') : (usableDocuments[0]?.documentId ?? ''),
  );

  if (kind === 'FIELD' && candidateFacts.length === 0) {
    return (
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        You have not recorded this field yet. Add it on your{' '}
        <a href={`/app/applicant/${applicantId}/profile`}>profile</a> first, then come back to
        submit it.
      </p>
    );
  }
  if (kind === 'DOCUMENT' && candidateDocuments.length === 0) {
    return (
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        You have not uploaded this document type yet. Upload it on your{' '}
        <a href={`/app/applicant/${applicantId}/documents`}>documents</a> page first, then come back
        to submit it.
      </p>
    );
  }

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name={kind === 'FIELD' ? 'factId' : 'documentId'} value={selection} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {kind === 'FIELD'
          ? candidateFacts.map((f) => (
              <label
                key={f.factId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.85rem',
                }}
              >
                <input
                  type="radio"
                  checked={selection === f.factId}
                  onChange={() => setSelection(f.factId)}
                />
                {f.value}
              </label>
            ))
          : candidateDocuments.map((d) => (
              <label
                key={d.documentId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.85rem',
                  opacity: d.usable ? 1 : 0.6,
                }}
              >
                <input
                  type="radio"
                  disabled={!d.usable}
                  checked={selection === d.documentId}
                  onChange={() => setSelection(d.documentId)}
                />
                {d.displayName}
                {!d.usable ? (
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    ({d.statusLabel.toLowerCase()}, not ready yet)
                  </span>
                ) : null}
              </label>
            ))}
      </div>
      <div>
        <button
          type="submit"
          className="btn btn-primary"
          style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
          disabled={pending || selection.length === 0}
        >
          {pending ? 'Submitting…' : 'Submit'}
        </button>
        {state.message ? (
          <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
