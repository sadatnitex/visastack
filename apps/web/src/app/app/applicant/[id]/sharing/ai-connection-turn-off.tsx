'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../components/form-feedback';
import { type AiConnectionActionState, turnOffAiConnectionAction } from './ai-connection-actions';

/**
 * Turn Off for one AI connection. It asks first, inside the page (never a browser pop-up), then
 * reloads the Sharing page so the connection moves out of the live list.
 */
export function AiConnectionTurnOff({
  applicantId,
  connectionId,
  appName,
}: {
  readonly applicantId: string;
  readonly connectionId: string;
  readonly appName: string;
}) {
  const [state, formAction, pending] = useActionState<AiConnectionActionState, FormData>(
    turnOffAiConnectionAction,
    NO_RESULT,
  );
  const [confirming, setConfirming] = useState(false);
  const question = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  // Keyboard focus follows the question: onto it when it opens, back to Turn Off when it closes.
  useEffect(() => {
    if (!moved.current) return;
    (confirming ? question.current : opener.current)?.focus();
  }, [confirming]);
  const ask = (open: boolean) => {
    moved.current = true;
    setConfirming(open);
  };
  useEffect(() => {
    if (state.ok && state.refreshPath) window.location.assign(state.refreshPath);
  }, [state]);

  return (
    <form action={formAction} className="ai-connection-turn-off">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="connectionId" value={connectionId} />
      {confirming ? (
        <div className="notice" role="alert" ref={question} tabIndex={-1}>
          <p className="u-m-0">
            Turn off {appName}? From its next request it can no longer read this record. To use it
            again, connect it again from the app.
          </p>
          <div className="page-actions">
            <SubmitButton
              pending={pending}
              idle="Yes, Turn Off"
              busy="Turning Off…"
              className="btn btn-danger"
            />
            <button type="button" className="btn btn-secondary" onClick={() => ask(false)}>
              Keep It On
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          ref={opener}
          className="btn btn-danger"
          aria-label={`Turn Off ${appName}`}
          onClick={() => ask(true)}
        >
          Turn Off
        </button>
      )}
      <FormMessage result={state} pending={pending} pendingText="Turning off…" />
    </form>
  );
}
