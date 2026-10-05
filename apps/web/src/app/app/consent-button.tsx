'use client';

import { type Locale, createTranslator } from '@visastack/i18n';
import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../components/form-feedback';
import { type ActionState, setConsentAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function ConsentButton({
  type,
  granted,
  locale,
  label,
}: {
  readonly type: string;
  readonly granted: boolean;
  readonly locale: Locale;
  /** The consent this button is for, so a list of identical "Grant" buttons can be told apart by ear. */
  readonly label?: string;
}) {
  const [state, formAction, pending] = useActionState(setConsentAction, INITIAL);
  const t = createTranslator(locale);
  const action = granted ? t('consent.action.revoke') : t('consent.action.grant');
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}
    >
      <form action={formAction}>
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="granted" value={String(!granted)} />
        <SubmitButton
          pending={pending}
          className={`btn ${granted ? 'btn-secondary' : 'btn-primary'}`}
          style={{ padding: '0.35rem 1rem', fontSize: '0.85rem' }}
          idle={action}
          busy="Saving…"
          {...(label ? { label: `${action}: ${label}` } : {})}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}
