'use client';

import { type Locale, createTranslator } from '@visastack/i18n';
import { useActionState } from 'react';
import { type ActionState, setConsentAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function ConsentButton({
  type,
  granted,
  locale,
}: {
  readonly type: string;
  readonly granted: boolean;
  readonly locale: Locale;
}) {
  const [state, formAction, pending] = useActionState(setConsentAction, INITIAL);
  const t = createTranslator(locale);
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
          {pending ? 'Saving…' : granted ? t('consent.action.revoke') : t('consent.action.grant')}
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
