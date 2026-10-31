'use client';

import { useActionState, useId } from 'react';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
} from '../../../../components/form-feedback';
import { connectSignInAction } from './actions';

const REASON_MAX = 500;

/**
 * Connect one waiting sign-in. The person checking ticks that they confirmed it with the account
 * holder outside VisaStack and says how; the server then asks for a fresh sign-in check.
 */
export function ConnectSignInForm({
  accountId,
  email,
}: {
  readonly accountId: string;
  readonly email: string;
}) {
  const [state, formAction, pending] = useActionState(connectSignInAction, NO_RESULT);
  const id = useId();
  const reasonId = `${id}-reason`;
  const hintId = `${id}-hint`;
  const confirmId = `${id}-confirm`;
  const messageId = `${id}-message`;
  const problem = fieldProblem(state, 'reason', messageId);
  const describedBy = [hintId, problem['aria-describedby']].filter(Boolean).join(' ');

  if (state.ok && state.message) {
    return <FormMessage id={messageId} result={state} />;
  }
  return (
    <form action={formAction} className="field-list form-compact">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="field-row">
        <label className="field-label" htmlFor={reasonId}>
          How You Checked
          <span className="sr-only"> for {email}</span>
        </label>
        <input
          id={reasonId}
          name="reason"
          type="text"
          maxLength={REASON_MAX}
          className="input"
          required
          aria-required
          aria-invalid={problem['aria-invalid']}
          aria-describedby={describedBy}
        />
        <p id={hintId} className="muted u-fs-085">
          For example: called the person on the number we already have. No passwords or codes.
        </p>
      </div>
      <div className="field-row">
        <input id={confirmId} name="confirmed" type="checkbox" value="yes" required />
        <label htmlFor={confirmId}>
          I confirmed with the person that they made this new sign-in
          <span className="sr-only"> for {email}</span>
        </label>
      </div>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Connecting…" />
      <div className="page-actions">
        <SubmitButton
          pending={pending}
          idle="Connect Sign-In"
          busy="Connecting…"
          label={`Connect Sign-In for ${email}`}
        />
      </div>
    </form>
  );
}
