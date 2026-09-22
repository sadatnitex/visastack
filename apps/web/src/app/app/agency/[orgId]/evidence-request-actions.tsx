'use client';

import { useActionState, useState } from 'react';
import {
  type ActionState,
  cancelEvidenceRequestAction,
  decideEvidenceResponseAction,
  startEvidenceReviewAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const REASON_PLACEHOLDER: Record<
  'NEEDS_REPLACEMENT' | 'CONTRADICTION' | 'CORRECTION_PROPOSED',
  string
> = {
  NEEDS_REPLACEMENT: 'What needs to be replaced, and why',
  CONTRADICTION: 'What this evidence contradicts on the applicant profile',
  CORRECTION_PROPOSED: 'The correction you suggest, and why',
};

/** The requesting org's side of a request awaiting their attention: start review, accept, ask for a replacement, or withdraw. */
export function EvidenceRequestActions({
  organizationId,
  requestId,
  status,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly status: string;
}) {
  const [reviewState, reviewAction, reviewPending] = useActionState(
    startEvidenceReviewAction,
    INITIAL,
  );
  const [decideState, decideAction, decidePending] = useActionState(
    decideEvidenceResponseAction,
    INITIAL,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelEvidenceRequestAction,
    INITIAL,
  );
  const [reasonOutcome, setReasonOutcome] = useState<
    'NEEDS_REPLACEMENT' | 'CONTRADICTION' | 'CORRECTION_PROPOSED' | null
  >(null);

  const anyMessage = reviewState.message || decideState.message || cancelState.message;
  const anyOk = reviewState.ok && decideState.ok && cancelState.ok;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {status === 'RECEIVED' ? (
          <form action={reviewAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="requestId" value={requestId} />
            <button
              type="submit"
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
              disabled={reviewPending}
            >
              {reviewPending ? 'Starting…' : 'Start review'}
            </button>
          </form>
        ) : null}
        <form action={decideAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="outcome" value="ACCEPTED" />
          <button
            type="submit"
            className="btn btn-primary"
            style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
            disabled={decidePending}
          >
            Accept
          </button>
        </form>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
          onClick={() =>
            setReasonOutcome((v) => (v === 'NEEDS_REPLACEMENT' ? null : 'NEEDS_REPLACEMENT'))
          }
        >
          Needs replacement
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
          onClick={() => setReasonOutcome((v) => (v === 'CONTRADICTION' ? null : 'CONTRADICTION'))}
        >
          Contradiction
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
          onClick={() =>
            setReasonOutcome((v) => (v === 'CORRECTION_PROPOSED' ? null : 'CORRECTION_PROPOSED'))
          }
        >
          Propose correction
        </button>
        <form action={cancelAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="requestId" value={requestId} />
          <button
            type="submit"
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
            disabled={cancelPending}
          >
            {cancelPending ? 'Cancelling…' : 'Cancel request'}
          </button>
        </form>
      </div>
      {reasonOutcome ? (
        <form
          action={decideAction}
          style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="outcome" value={reasonOutcome} />
          <input
            name="reason"
            type="text"
            required
            className="input"
            placeholder={REASON_PLACEHOLDER[reasonOutcome]}
            style={{ fontSize: '0.8rem' }}
          />
          <button
            type="submit"
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
            disabled={decidePending}
          >
            {decidePending ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : null}
      {anyMessage ? (
        <p className={`field-msg ${anyOk ? 'field-msg-ok' : 'field-msg-err'}`}>{anyMessage}</p>
      ) : null}
    </div>
  );
}
