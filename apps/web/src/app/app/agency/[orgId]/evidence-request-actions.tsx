'use client';

import { useActionState, useState } from 'react';
import {
  type ActionState,
  cancelEvidenceRequestAction,
  decideEvidenceResponseAction,
  startEvidenceReviewAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

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
  const [showReplaceReason, setShowReplaceReason] = useState(false);

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
          onClick={() => setShowReplaceReason((v) => !v)}
        >
          Needs replacement
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
      {showReplaceReason ? (
        <form
          action={decideAction}
          style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="outcome" value="NEEDS_REPLACEMENT" />
          <input
            name="reason"
            type="text"
            required
            className="input"
            placeholder="What needs to be replaced, and why"
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
