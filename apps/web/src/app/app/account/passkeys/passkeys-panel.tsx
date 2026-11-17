'use client';

import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { useEffect, useId, useState } from 'react';
import { finishPasskeyAddAction, startPasskeyAddAction } from '../../../auth/passkey-actions';

/**
 * Add a passkey (Q8). Needs the password typed in the last five minutes; otherwise the person is
 * offered the password re-check and comes back here. Says plainly when this browser cannot make
 * passkeys, instead of showing a button that cannot work.
 */
export function AddPasskey() {
  const nameId = useId();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reauthUrl, setReauthUrl] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  if (supported === null) return null;
  if (!supported) {
    return (
      <p className="card-body">
        This browser cannot save passkeys. Try a recent version of Safari, Chrome, Edge or Firefox.
      </p>
    );
  }

  async function add(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setReauthUrl(null);
    try {
      const started = await startPasskeyAddAction();
      if (!started.ok) {
        setMessage(started.message);
        setReauthUrl(started.reauthUrl ?? null);
        return;
      }
      let answer: unknown;
      try {
        answer = await startRegistration({ optionsJSON: started.options });
      } catch {
        setMessage('No passkey was saved. You can try again whenever you like.');
        return;
      }
      const finished = await finishPasskeyAddAction(answer, label);
      if (!finished.ok) {
        setMessage(finished.message);
        setReauthUrl(finished.reauthUrl ?? null);
        return;
      }
      window.location.assign(`${finished.next}?n=added`);
    } catch {
      setMessage('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-list u-mt-050">
      <label className="field-label" htmlFor={nameId}>
        Name for This Passkey (Optional)
      </label>
      <input
        id={nameId}
        className="field-input"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        maxLength={60}
        placeholder="For example, My Phone"
      />
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void add()}
        aria-disabled={busy}
      >
        {busy ? 'Waiting for Your Device' : 'Add a Passkey'}
      </button>
      <output className="field-msg" aria-live="polite">
        {message}
        {reauthUrl ? (
          <>
            {' '}
            <a href={reauthUrl}>Type Your Password</a>
          </>
        ) : null}
      </output>
    </div>
  );
}
