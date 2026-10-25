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
  text,
}: {
  readonly type: string;
  readonly granted: boolean;
  readonly locale: Locale;
  /** The consent this button is for, so a list of identical "Grant" buttons can be told apart by ear. */
  readonly label?: string;
  /**
   * Visible words instead of Turn on / Turn off, for a screen that shows this one consent alone
   * (first run: "Allow core processing"). The form and the values it sends are unchanged.
   */
  readonly text?: string;
}) {
  const [state, formAction, pending] = useActionState(setConsentAction, INITIAL);
  const t = createTranslator(locale);
  // English screens say Turn on / Turn off; Bangla keeps its existing words until that work resumes.
  const english = locale === 'en';
  const action = english
    ? granted
      ? 'Turn Off'
      : 'Turn On'
    : granted
      ? t('consent.action.revoke')
      : t('consent.action.grant');
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
          style={{ padding: '0.35rem 1rem', fontSize: 'var(--text-small)' }}
          idle={text ?? action}
          busy="Saving…"
          {...(label && !text ? { label: `${action}: ${label}` } : {})}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}
