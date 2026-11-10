'use client';

import { useActionState, useRef } from 'react';
import { CodeInput } from '../../components/code-input';
import {
  FieldError,
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../components/form-feedback';
import {
  type GuestActionState,
  leaveAction,
  retentionAction,
  sendCodeAction,
  verifyCodeAction,
} from './actions';
import { RetentionChoice } from './retention-choice';

const INITIAL: GuestActionState = { ok: true, message: '' };

/** Ask for a code by email (to the address the agency has; the visitor types none). */
export function SendCodeForm({ again = false }: { readonly again?: boolean }) {
  const [state, formAction, pending] = useActionState(sendCodeAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <SubmitButton
        pending={pending}
        idle={again ? 'Send a New Code' : 'Email Me a Code'}
        busy="Sending…"
        className={again ? 'btn btn-secondary' : 'btn btn-primary'}
      />
      <FormMessage
        id={again ? 'guest-code-again-message' : 'guest-code-send-message'}
        result={state}
        pending={pending}
        pendingText="Sending…"
      />
    </form>
  );
}

/** Type the six-digit code from the email. */
export function VerifyCodeForm() {
  const [state, formAction, pending] = useActionState(verifyCodeAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = 'guest-code-verify-message';
  return (
    <form ref={form} action={formAction} className="field-list form-narrow">
      <div className="field-row">
        <label className="field-label" htmlFor="guest-code">
          Six-Digit Code
        </label>
        <CodeInput
          id="guest-code"
          name="code"
          {...fieldProblem(state, 'code', messageId, 'guest-code-hint')}
        />
        <p id="guest-code-hint" className="muted u-fs-085">
          It works for 10 minutes. Only the newest code works.
        </p>
        <FieldError result={state} field="code" />
      </div>
      <SubmitButton pending={pending} idle="Continue" busy="Checking…" />
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Checking…" />
    </form>
  );
}

/** Choose how long the agency may keep the files after the request closes. */
export function RetentionForm({
  agencyName,
  value,
  periods,
}: {
  readonly agencyName: string | null;
  readonly value: number | null;
  readonly periods: readonly number[];
}) {
  const [state, formAction, pending] = useActionState(retentionAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = 'guest-retention-message';
  const invalid = !state.ok && state.field === 'retentionDays';
  return (
    <form ref={form} action={formAction} className="field-list">
      <RetentionChoice
        agencyName={agencyName}
        value={value}
        periods={periods}
        invalid={invalid}
        {...(invalid ? { describedBy: messageId } : {})}
      />
      <SubmitButton
        pending={pending}
        idle="Save My Choice"
        busy="Saving…"
        className="btn btn-secondary"
      />
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving…" />
    </form>
  );
}

/** End this device's desk session. */
export function LeaveForm() {
  const [state, formAction, pending] = useActionState(leaveAction, INITIAL);
  return (
    <form action={formAction}>
      <SubmitButton pending={pending} idle="Leave" busy="Leaving…" className="btn btn-secondary" />
      <FormMessage
        id="guest-leave-message"
        result={state}
        pending={pending}
        pendingText="Leaving…"
      />
    </form>
  );
}
