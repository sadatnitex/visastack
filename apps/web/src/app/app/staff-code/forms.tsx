'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../components/form-feedback';
import {
  type StaffCodeState,
  confirmStaffEnrolmentAction,
  regenerateRecoveryCodesAction,
} from './actions';

const INITIAL: StaffCodeState = { ok: true, message: '' };

/** The backup codes, shown once, with a required "I have saved these" step before moving on. */
function BackupCodes({
  codes,
  continueHref,
}: { readonly codes: readonly string[]; readonly continueHref: string }) {
  const [saved, setSaved] = useState(false);
  const checkId = useId();
  return (
    <div className="card u-mb-100">
      <h2 className="card-title">Save Your Backup Codes</h2>
      <p className="card-body">
        Each code works once if you lose your phone. They are shown only now. Keep them somewhere
        safe, apart from your phone.
      </p>
      <ol className="rows u-mb-100" aria-label="Backup codes">
        {codes.map((code) => (
          <li key={code} className="row">
            <code className="row-val">{code}</code>
          </li>
        ))}
      </ol>
      <div className="field-row">
        <label className="field-label" htmlFor={checkId}>
          <input
            id={checkId}
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
          />{' '}
          I Have Saved These Codes
        </label>
      </div>
      <a
        className="btn btn-primary"
        href={continueHref}
        aria-disabled={!saved}
        onClick={(event) => {
          if (!saved) event.preventDefault();
        }}
      >
        Continue
      </a>
    </div>
  );
}

export function ConfirmEnrolmentForm({ returnTo }: { readonly returnTo: string }) {
  const [state, formAction, pending] = useActionState(confirmStaffEnrolmentAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalidField(formRef, state);
  if (state.ok && state.recoveryCodes) {
    return <BackupCodes codes={state.recoveryCodes} continueHref={returnTo} />;
  }
  return (
    <form ref={formRef} action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor="enrol-code">
          6 Digit Code From Your App
        </label>
        <input
          id="enrol-code"
          name="code"
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={10}
          required
          {...fieldProblem(state, 'code', 'enrol-code-message')}
        />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Turn On"
          busy="Checking…"
          className="btn btn-primary"
        />
        <FormMessage id="enrol-code-message" result={state} />
      </div>
    </form>
  );
}

export function RegenerateCodesForm({ returnTo }: { readonly returnTo: string }) {
  const [state, formAction, pending] = useActionState(regenerateRecoveryCodesAction, INITIAL);
  if (state.ok && state.recoveryCodes) {
    return <BackupCodes codes={state.recoveryCodes} continueHref={returnTo} />;
  }
  return (
    <form action={formAction} className="field-list">
      <p className="card-body">
        Make a new set of ten backup codes. The old ones stop working at once.
      </p>
      <div>
        <SubmitButton
          pending={pending}
          idle="Make New Backup Codes"
          busy="Working…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
