'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';
import {
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
} from '../../../../components/form-feedback';
import { CONSENT_PLAIN } from '../../../../lib/labels';
import { setConsentAction } from '../../actions';

const CORE = 'CORE_PROCESSING';

/**
 * The one consent joining a trip needs: that VisaStack may process the person's account details.
 * Turning it on refreshes the page, which then shows the form. Nothing else is switched on.
 */
export function CoreConsentStep() {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    setConsentAction,
    NO_RESULT,
  );
  const router = useRouter();
  const refreshed = useRef(false);
  useEffect(() => {
    if (state.ok && state.message.length > 0 && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [state, router]);
  const plain = CONSENT_PLAIN[CORE];
  return (
    <form action={action} className="companion-consent">
      <input type="hidden" name="type" value={CORE} />
      <input type="hidden" name="granted" value="true" />
      <p className="u-m-0">
        <strong>{plain?.name}</strong>
      </p>
      <p className="muted u-fs-085 u-m-0">{plain?.meaning}</p>
      <SubmitButton
        pending={pending}
        idle="Turn On"
        busy="Turning on…"
        className="btn btn-secondary"
      />
      <FormMessage result={state} />
    </form>
  );
}
