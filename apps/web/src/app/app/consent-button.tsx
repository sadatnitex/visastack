'use client';

import { useActionState } from 'react';
import { type ActionState, setConsentAction } from './actions';
import type { ConsentButtonMessages } from './consent-button.messages';

const INITIAL: ActionState = { ok: true, message: '' };

export function ConsentButton({
  type,
  granted,
  messages,
}: {
  readonly type: string;
  readonly granted: boolean;
  readonly messages: ConsentButtonMessages;
}) {
  const [state, formAction, pending] = useActionState(setConsentAction, INITIAL);
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}
    >
      <form action={formAction}>
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="granted" value={String(!granted)} />
        <button
          type="submit"
          className={`btn ${granted ? 'btn-secondary' : 'btn-primary'}`}
          style={{ padding: '0.35rem 1rem', fontSize: '0.85rem' }}
          disabled={pending}
        >
          {pending
            ? messages['consent.saving']
            : granted
              ? messages['consent.action.revoke']
              : messages['consent.action.grant']}
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
