'use client';

import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { finishPasskeyConfirmAction, startPasskeyConfirmAction } from './passkey-actions';

/**
 * "Use Face ID, Fingerprint or Screen Lock" on the confirm-it-is-you page (Q8). Shown only when
 * the server already decided a passkey can help, and only in a browser that supports passkeys.
 * The password form below it always stays, so nothing here can leave a person stuck.
 */
export function PasskeyConfirm({ returnTo }: { returnTo: string }) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  if (!supported) return null;

  async function confirm(): Promise<void> {
    setBusy(true);
    setMessage('');
    try {
      const started = await startPasskeyConfirmAction();
      if (!started.ok) {
        setMessage(started.message);
        return;
      }
      let answer: unknown;
      try {
        answer = await startAuthentication({ optionsJSON: started.options });
      } catch {
        setMessage('The passkey check was cancelled. Try again, or type your password below.');
        return;
      }
      const finished = await finishPasskeyConfirmAction(answer, returnTo);
      if (!finished.ok) {
        setMessage(finished.message);
        return;
      }
      window.location.assign(finished.next);
    } catch {
      setMessage('Something went wrong. Type your password below instead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card u-mb-100">
      <div className="field-list">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void confirm()}
          aria-disabled={busy}
          disabled={busy}
        >
          {busy ? 'Checking' : 'Use Face ID, Fingerprint or Screen Lock'}
        </button>
        <output className="field-msg" aria-live="polite">
          {message}
        </output>
        <p className="card-body">Or type your password below.</p>
      </div>
    </div>
  );
}
