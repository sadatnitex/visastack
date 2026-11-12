'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { useT } from '../../../../../components/i18n-provider';
import { applicantSharingCatalog } from '../../../../../i18n/applicant-sharing';
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
  const t = useT(applicantSharingCatalog);
  return (
    <div className="sharing-case-exceptions">
      <p className="muted u-m-0">
        {t.node(
          'applicantSharing.appApplicantIdSharingCaseExceptions.thisAccessCoversEveryCaseExcept',
        )}
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
  const t = useT(applicantSharingCatalog);
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
          {exception.sharedSeparately
            ? t.node('applicantSharing.appApplicantIdSharingCaseExceptions.sharedSeparately')
            : t.node('applicantSharing.appApplicantIdSharingCaseExceptions.notShared')}
          : {exception.title}
        </span>
        {exception.sharedSeparately ? (
          <span className="muted">
            {t.node(
              'applicantSharing.appApplicantIdSharingCaseExceptions.recipientlabelSeesThisCaseThroughAnother',
              { recipientLabel },
            )}
          </span>
        ) : null}
        {confirming ? (
          <div className="notice" role="alert" ref={confirmRef}>
            <p className="u-m-0">
              {t.node(
                'applicantSharing.appApplicantIdSharingCaseExceptions.recipientlabelWillBeAbleToSee',
                { recipientLabel },
              )}
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
                onClick={() => {
                  returnFocus.current = true;
                  setConfirming(false);
                }}
              >
                {t.node('applicantSharing.appApplicantIdSharingCaseExceptions.keepItPrivate')}
              </button>
            </div>
          </div>
        ) : (
          <button
            ref={allowRef}
            type="button"
            className="btn btn-secondary u-btn-sm"
            aria-label={t(
              'applicantSharing.appApplicantIdSharingCaseExceptions.allowThisCaseTitle',
              { title: exception.title },
            )}
            onClick={() => setConfirming(true)}
          >
            {t.node('applicantSharing.appApplicantIdSharingCaseExceptions.allowThisCase')}
          </button>
        )}
        <div ref={messageRef} tabIndex={-1} className="sharing-case-exception-message">
          <FormMessage result={state} />
        </div>
      </form>
    </li>
  );
}
