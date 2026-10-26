'use client';

import { useActionState, useEffect, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { type ActionState, allowCaseAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * The cases one all-cases access does not cover (per-case sharing
 * exceptions), each with "Allow This Case". Allowing widens access, so it
 * asks inside the page first, the same way revoking does.
 */
export function CaseExceptions({
  applicantId,
  grantId,
  recipientLabel,
  exceptions,
}: {
  readonly applicantId: string;
  readonly grantId: string;
  readonly recipientLabel: string;
  readonly exceptions: ReadonlyArray<{ readonly missionId: string; readonly title: string }>;
}) {
  const [state, formAction, pending] = useActionState(allowCaseAction, INITIAL);
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    if (state.ok && state.refreshPath) window.location.assign(state.refreshPath);
  }, [state]);

  return (
    <div className="sharing-case-exceptions">
      <p className="muted u-m-0">
        This access covers every case except the ones below. Documents and profile details you
        shared stay shared.
      </p>
      <ul className="sharing-case-exceptions-list">
        {exceptions.map((exception) => (
          <li key={exception.missionId}>
            <form action={formAction} className="sharing-case-exception">
              <input type="hidden" name="applicantId" value={applicantId} />
              <input type="hidden" name="grantId" value={grantId} />
              <input type="hidden" name="missionId" value={exception.missionId} />
              <span>Not Shared: {exception.title}</span>
              {confirming === exception.missionId ? (
                <div className="notice" role="alert">
                  <p className="u-m-0">
                    {recipientLabel} will be able to see this case and its records.
                  </p>
                  <div className="sharing-case-exception-choices">
                    <SubmitButton
                      pending={pending}
                      idle="Yes, Allow This Case"
                      busy="Allowing"
                      className="btn btn-primary u-btn-sm"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary u-btn-sm"
                      onClick={() => setConfirming(null)}
                    >
                      Keep It Private
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary u-btn-sm"
                  onClick={() => setConfirming(exception.missionId)}
                >
                  Allow This Case
                </button>
              )}
            </form>
          </li>
        ))}
      </ul>
      <FormMessage result={state} />
    </div>
  );
}
