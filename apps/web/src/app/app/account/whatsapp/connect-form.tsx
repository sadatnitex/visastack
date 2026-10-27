'use client';

import { useActionState, useId, useRef } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { type ConnectState, startWhatsAppLinkAction } from './actions';

const INITIAL: ConnectState = { ok: true, message: '' };

/** Asks for agreement, then shows the one-time code to send from WhatsApp. */
export function ConnectWhatsAppForm() {
  const [state, formAction, pending] = useActionState(startWhatsAppLinkAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  const optInId = useId();
  useFocusInvalidField(formRef, state);

  if (state.ok && state.code) {
    return (
      <div className="field-stack">
        <p className="card-body">
          Send this message from the WhatsApp you want to connect. The code works for 10 minutes and
          only once.
        </p>
        <p className="mono" translate="no">
          <strong>{state.whatsappMessage}</strong>
        </p>
        <div className="page-actions">
          {state.whatsappHref ? (
            <a className="btn btn-primary" href={state.whatsappHref} rel="noopener noreferrer">
              Open WhatsApp
            </a>
          ) : null}
          <a className="btn btn-secondary" href="/app/account/whatsapp">
            I Have Sent It
          </a>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} ref={formRef} className="field-stack">
      <label htmlFor={optInId} className="check output-check">
        <input
          id={optInId}
          type="checkbox"
          name="optIn"
          value="yes"
          {...fieldProblem(state, 'optIn', messageId)}
        />
        <span className="output-check-text">
          I agree to receive messages from VisaStack on WhatsApp about my cases. I can send STOP at
          any time.
        </span>
      </label>
      <div>
        <SubmitButton pending={pending} idle="Get a Code" busy="Making Your Code" />
      </div>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Making your code" />
    </form>
  );
}
