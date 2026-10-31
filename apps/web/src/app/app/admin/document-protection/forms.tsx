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
  /** The name of what the switch covers, used in the button and field names. */
  readonly name: string;
  readonly restricted: boolean;
  readonly defaultRestricted: boolean;
  readonly overridden: boolean;
  /** An extra sentence shown before turning this protection off. */
  readonly offWarning?: string;
}

const REASON_MAX = 500;
const REASON_HINT = 'Say why, without names or document details.';

type Removal = 'off' | 'default';

/**
 * One on/off control. Turning protection on saves straight away, with an
 * optional reason. Removing protection (turning off, or going back to a
 * standard setting that is off) first opens a confirmation on the page with
 * a required reason, then the server asks for a fresh sign-in check.
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
  const [confirming, setConfirming] = useState<Removal | null>(null);
  const [reason, setReason] = useState('');
  const reasonInput = useRef<HTMLInputElement>(null);
  const openers = useRef<Record<Removal, HTMLButtonElement | null>>({ off: null, default: null });
  const returnFocusTo = useRef<Removal | null>(null);
  const id = useId();
  const reasonId = `${id}-reason`;
  const hintId = `${id}-hint`;
  const messageId = `${id}-message`;
  const warningId = `${id}-warning`;
  const resetLoosens = overridden && restricted && !defaultRestricted;

  useEffect(() => {
    if (confirming) {
      reasonInput.current?.focus();
    } else if (returnFocusTo.current) {
      openers.current[returnFocusTo.current]?.focus();
      returnFocusTo.current = null;
    }
  }, [confirming]);
  useEffect(() => {
    if (state.ok && state.message) setConfirming(null);
  }, [state]);

  const problem = fieldProblem(state, 'reason', messageId);
  const describedBy = [confirming ? warningId : null, hintId, problem['aria-describedby']]
    .filter(Boolean)
    .join(' ');

  return (
    <form action={formAction} className="field-list form-compact">
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="key" value={switchKey} />

      {confirming ? (
        <p id={warningId} className="notice notice-warn">
          Turn off the sign-in check for {name}? Anyone who can already see these documents will be
          able to preview and download them without confirming it is them first.
          {offWarning ? ` ${offWarning}` : ''}
        </p>
      ) : null}

      <div className="field-row">
        <label className="field-label" htmlFor={reasonId}>
          {confirming ? 'Reason' : 'Reason (optional)'}
          <span className="sr-only"> for {name}</span>
        </label>
        <input
          ref={reasonInput}
          id={reasonId}
          name="reason"
          type="text"
          maxLength={REASON_MAX}
          className="input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required={confirming !== null}
          aria-required={confirming !== null ? true : undefined}
          aria-invalid={problem['aria-invalid']}
          aria-describedby={describedBy}
        />
        <p id={hintId} className="muted u-fs-085">
          {REASON_HINT}
        </p>
      </div>

      {confirming ? (
        <>
          <input type="hidden" name="confirmed" value="yes" />
          <div className="page-actions">
            <button
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
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                returnFocusTo.current = confirming;
                setConfirming(null);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="page-actions">
          {restricted ? (
            <button
              ref={(node) => {
                openers.current.off = node;
              }}
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
                ref={(node) => {
                  openers.current.default = node;
                }}
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
