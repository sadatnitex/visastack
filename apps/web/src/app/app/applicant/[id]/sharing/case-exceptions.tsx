'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { type ActionState, allowCaseAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** One case an all-cases access does not cover. */
export interface CaseExceptionItem {
  readonly missionId: string;
  readonly title: string;
  /**
   * The same recipient still sees this case through another access (one for
   * this case alone, for example), so it is not "Not Shared" with them.
   */
  readonly sharedSeparately?: boolean;
}

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
  readonly exceptions: readonly CaseExceptionItem[];
}) {
  return (
    <div className="sharing-case-exceptions">
      <p className="muted u-m-0">
        This access covers every case except the ones below. Documents and profile details you
        shared stay shared.
      </p>
      <ul className="sharing-case-exceptions-list">
        {exceptions.map((exception) => (
          <CaseExceptionRow
            key={exception.missionId}
            applicantId={applicantId}
            grantId={grantId}
            recipientLabel={recipientLabel}
            exception={exception}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * One case with its own answer, so a message always sits next to the case it
 * is about. Focus follows the choice: opening the question moves it to the
 * confirm button, "Keep It Private" returns it to "Allow This Case", and a
 * refusal moves it to the row's message.
 */
function CaseExceptionRow({
  applicantId,
  grantId,
  recipientLabel,
  exception,
}: {
  readonly applicantId: string;
  readonly grantId: string;
  readonly recipientLabel: string;
  readonly exception: CaseExceptionItem;
}) {
  const [state, formAction, pending] = useActionState(allowCaseAction, INITIAL);
  const [confirming, setConfirming] = useState(false);
  const allowRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (state.ok && state.refreshPath) window.location.assign(state.refreshPath);
    if (!state.ok && state.message) {
      setConfirming(false);
      messageRef.current?.focus();
    }
  }, [state]);

  useEffect(() => {
    if (confirming) {
      confirmRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      allowRef.current?.focus();
    }
  }, [confirming]);

  return (
    <li>
      <form action={formAction} className="sharing-case-exception">
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="grantId" value={grantId} />
        <input type="hidden" name="missionId" value={exception.missionId} />
        <span>
          {exception.sharedSeparately ? 'Shared Separately' : 'Not Shared'}: {exception.title}
        </span>
        {exception.sharedSeparately ? (
          <span className="muted">
            {recipientLabel} sees this case through another access you gave.
          </span>
        ) : null}
        {confirming ? (
          <div className="notice" role="alert" ref={confirmRef}>
            <p className="u-m-0">{recipientLabel} will be able to see this case and its records.</p>
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
                onClick={() => {
                  returnFocus.current = true;
                  setConfirming(false);
                }}
              >
                Keep It Private
              </button>
            </div>
          </div>
        ) : (
          <button
            ref={allowRef}
            type="button"
            className="btn btn-secondary u-btn-sm"
            aria-label={`Allow This Case: ${exception.title}`}
            onClick={() => setConfirming(true)}
          >
            Allow This Case
          </button>
        )}
        <div ref={messageRef} tabIndex={-1} className="sharing-case-exception-message">
          <FormMessage result={state} />
        </div>
      </form>
    </li>
  );
}
