'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
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
  CONTRADICTION: "What this evidence contradicts on the traveller's profile",
  CORRECTION_PROPOSED: 'The correction you suggest, and why',
};

/** How the service starts the sentence it uses when a newer copy arrived or the copy was decided. */
const STALE_START = 'A newer copy was sent';

/**
 * The requesting org's side of a request awaiting their attention: start review, accept, ask for a
 * replacement, or withdraw.
 *
 * `submissionId` is the copy the reviewer was shown (the one waiting). It is posted with Accept and
 * with every reason, so a copy that arrived after the page was drawn is never decided unseen: the
 * service refuses and the reviewer is asked to refresh. It is left out only when nothing is pinned
 * (a send made before exact copies were kept). `canDecide` is false when the copy could not be
 * shown on the card: then no decision is offered, and withdrawing the request still is.
 */
export function EvidenceRequestActions({
  organizationId,
  requestId,
  status,
  submissionId,
  canDecide = true,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly status: string;
  readonly submissionId?: string | undefined;
  readonly canDecide?: boolean;
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
  const stale = !decideState.ok && decideState.message.startsWith(STALE_START);
  const refreshHref = `/app/agency/${organizationId}/clients?request=${requestId}#request-${requestId}`;
  const pinned = submissionId ? (
    <input type="hidden" name="submissionId" value={submissionId} />
  ) : null;

  return (
    <div className="request-decision">
      <div className="request-decision-buttons">
        {canDecide ? (
          <>
            <form action={decideAction}>
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="requestId" value={requestId} />
              <input type="hidden" name="outcome" value="ACCEPTED" />
              {pinned}
              <SubmitButton
                pending={decidePending}
                idle="Accept"
                busy="Accept"
                className="btn btn-primary request-decision-button"
              />
            </form>
            <button
              type="button"
              className="btn btn-secondary request-decision-button"
              aria-expanded={reasonOutcome === 'NEEDS_REPLACEMENT'}
              onClick={() =>
                setReasonOutcome((v) => (v === 'NEEDS_REPLACEMENT' ? null : 'NEEDS_REPLACEMENT'))
              }
            >
              Needs Replacement
            </button>
          </>
        ) : null}
        <details className="request-decision-more">
          <summary className="request-decision-more-toggle">More Decisions</summary>
          <div className="request-decision-more-body">
            {canDecide && status === 'RECEIVED' ? (
              <form action={reviewAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="requestId" value={requestId} />
                <SubmitButton
                  pending={reviewPending}
                  idle="Start Review"
                  busy="Starting…"
                  className="btn btn-secondary request-decision-button"
                />
              </form>
            ) : null}
            {canDecide ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary request-decision-button"
                  aria-expanded={reasonOutcome === 'CONTRADICTION'}
                  onClick={() =>
                    setReasonOutcome((v) => (v === 'CONTRADICTION' ? null : 'CONTRADICTION'))
                  }
                >
                  Contradiction
                </button>
                <button
                  type="button"
                  className="btn btn-secondary request-decision-button"
                  aria-expanded={reasonOutcome === 'CORRECTION_PROPOSED'}
                  onClick={() =>
                    setReasonOutcome((v) =>
                      v === 'CORRECTION_PROPOSED' ? null : 'CORRECTION_PROPOSED',
                    )
                  }
                >
                  Propose Correction
                </button>
              </>
            ) : null}
            <form action={cancelAction}>
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="requestId" value={requestId} />
              <SubmitButton
                pending={cancelPending}
                idle="Cancel Request"
                busy="Cancelling…"
                className="btn btn-secondary request-decision-button"
              />
            </form>
          </div>
        </details>
      </div>
      {canDecide && reasonOutcome ? (
        <form
          action={decideAction}
          // A sentence-long reason beside its button, kept to a readable width on a wide row.
          className="form-compact request-decision-reason"
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="outcome" value={reasonOutcome} />
          {pinned}
          <input
            name="reason"
            type="text"
            required
            className="input u-fs-085"
            aria-label="Reason"
            placeholder={REASON_PLACEHOLDER[reasonOutcome]}
          />
          <SubmitButton
            pending={decidePending}
            idle="Send"
            busy="Sending…"
            className="btn btn-secondary request-decision-button"
          />
        </form>
      ) : null}
      <FormMessage result={{ ok: anyOk, message: anyMessage }} />
      {stale ? (
        <p className="u-m-0">
          <a className="request-decision-refresh" href={refreshHref}>
            Refresh
          </a>
        </p>
      ) : null}
    </div>
  );
}
