'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import {
  FormMessage,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
} from '../../../../components/form-feedback';
import { setDocumentProtectionAction } from './actions';

export interface ProtectionSwitchProps {
  readonly scope: 'CATEGORY' | 'DOCUMENT_TYPE' | 'UNKNOWN_TYPE';
  readonly switchKey: string;
  /** The name of what the switch covers, used in the button names. */
  readonly name: string;
  readonly restricted: boolean;
  readonly defaultRestricted: boolean;
  readonly overridden: boolean;
  /** An extra sentence shown before turning this protection off. */
  readonly offWarning?: string;
}

const REASON_MAX = 500;

/**
 * One on/off control. Turning protection on saves straight away. Turning it
 * off (or going back to a standard setting that is off) first asks for
 * confirmation on the page, then the server asks for a fresh sign-in check.
 */
export function ProtectionSwitch({
  scope,
  switchKey,
  name,
  restricted,
  defaultRestricted,
  overridden,
  offWarning,
}: ProtectionSwitchProps) {
  const [state, formAction, pending] = useActionState(setDocumentProtectionAction, NO_RESULT);
  const [confirming, setConfirming] = useState<'off' | 'default' | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const reasonId = `${id}-reason`;
  const messageId = `${id}-message`;
  const warningId = `${id}-warning`;
  const resetLoosens = overridden && restricted && !defaultRestricted;

  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (state.ok && state.message) setConfirming(null);
  }, [state]);

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="key" value={switchKey} />
      <div className="field-row">
        <label className="field-label" htmlFor={reasonId}>
          Reason (optional)
        </label>
        <input
          id={reasonId}
          name="reason"
          type="text"
          maxLength={REASON_MAX}
          className="input"
          placeholder="For example, what travellers or agencies told you"
          {...fieldProblem(state, 'reason', messageId)}
        />
      </div>

      {confirming ? (
        <div className="notice notice-warn">
          <p id={warningId}>
            Turn off the sign-in check for {name}? Anyone who can already see these documents will
            be able to preview and download them without confirming it is them first.
            {offWarning ? ` ${offWarning}` : ''}
          </p>
          <input type="hidden" name="confirmed" value="yes" />
          <div className="page-actions">
            <button
              ref={confirmButton}
              type="submit"
              name="choice"
              value={confirming}
              className="btn btn-primary"
              aria-describedby={warningId}
              aria-disabled={pending ? true : undefined}
              onClick={(event) => {
                if (pending) event.preventDefault();
              }}
            >
              {pending ? 'Saving…' : 'Yes, Turn Off'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="page-actions">
          {restricted ? (
            <button
              type="button"
              className="btn btn-secondary"
              aria-label={`Turn Off for ${name}`}
              onClick={() => setConfirming('off')}
            >
              Turn Off
            </button>
          ) : (
            <SubmitButton
              pending={pending}
              name="choice"
              value="on"
              idle="Turn On"
              busy="Saving…"
              label={`Turn On for ${name}`}
              className="btn btn-primary"
            />
          )}
          {overridden ? (
            resetLoosens ? (
              <button
                type="button"
                className="btn btn-secondary"
                aria-label={`Use Standard Setting for ${name}`}
                onClick={() => setConfirming('default')}
              >
                Use Standard Setting
              </button>
            ) : (
              <SubmitButton
                pending={pending}
                name="choice"
                value="default"
                idle="Use Standard Setting"
                busy="Saving…"
                label={`Use Standard Setting for ${name}`}
                className="btn btn-secondary"
              />
            )
          ) : null}
        </div>
      )}
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
