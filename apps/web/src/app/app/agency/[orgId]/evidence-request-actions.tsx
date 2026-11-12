'use client';

import { useActionState, useMemo, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
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
  const t = useT(appAgencyCatalog);
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
  // One value per outcome, so the done strip is raised once for it and not again on every render.
  const anyResult = useMemo(() => ({ ok: anyOk, message: anyMessage }), [anyOk, anyMessage]);
  const stale = !decideState.ok && decideState.stale === true;
  const refreshHref = `/app/agency/${organizationId}/clients?request=${requestId}#request-${requestId}`;
  const pinned = submissionId ? (
    <input type="hidden" name="submissionId" value={submissionId} />
  ) : null;

  const cancelForm = (
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
  );

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
              {t.node('appAgency.appAgencyOrgidEvidenceRequestActions.needsReplacement')}
            </button>
          </>
        ) : null}
        {canDecide ? (
          <details className="request-decision-more">
            <summary className="request-decision-more-toggle">
              {t.node('appAgency.appAgencyOrgidEvidenceRequestActions.moreDecisions')}
            </summary>
            <div className="request-decision-more-body">
              {status === 'RECEIVED' ? (
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
              <button
                type="button"
                className="btn btn-secondary request-decision-button"
                aria-expanded={reasonOutcome === 'CONTRADICTION'}
                onClick={() =>
                  setReasonOutcome((v) => (v === 'CONTRADICTION' ? null : 'CONTRADICTION'))
                }
              >
                {t.node('appAgency.appAgencyOrgidEvidenceRequestActions.contradiction')}
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
                {t.node('appAgency.appAgencyOrgidEvidenceRequestActions.proposeCorrection')}
              </button>
              {cancelForm}
            </div>
          </details>
        ) : (
          cancelForm
        )}
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
            aria-label={t('appAgency.appAgencyOrgidEvidenceRequestActions.reason')}
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
      <FormMessage result={anyResult} />
      {stale ? (
        <p className="u-m-0">
          <a className="request-decision-refresh" href={refreshHref}>
            {t.node('appAgency.appAgencyOrgidEvidenceRequestActions.refresh')}
          </a>
        </p>
      ) : null}
    </div>
  );
}
