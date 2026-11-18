'use client';

import { type ReactNode, useActionState } from 'react';
import { FormMessage, SubmitButton } from './form-feedback';

export interface DeclineInvitationState {
  readonly ok: boolean;
  readonly message: string;
}

export interface DeclineInvitationLabels {
  /** The secondary action next to accepting, and the confirm button: "Decline". */
  readonly decline: ReactNode;
  /** What saying no does, shown once the person opens Decline. */
  readonly explain: ReactNode;
  readonly confirm: ReactNode;
  readonly busy: ReactNode;
}

const INITIAL: DeclineInvitationState = { ok: true, message: '' };

/**
 * DECL1: say no to an invitation on its accept screen. Decline opens a short confirm in place (a
 * plain disclosure, no dialog, so nothing traps focus) and one more press ends the invitation. It is
 * an ordinary form post, so it works with JavaScript off. The page shows it only while the
 * invitation is open and the update that stores a decline is in place.
 */
export function DeclineInvitation({
  token,
  action,
  labels,
}: {
  readonly token: string;
  readonly action: (
    previous: DeclineInvitationState,
    form: FormData,
  ) => Promise<DeclineInvitationState>;
  readonly labels: DeclineInvitationLabels;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <details className="lc-g3-withdraw" data-testid="decline-invitation">
      <summary className="btn btn-secondary">{labels.decline}</summary>
      <form action={formAction} className="lc-g3-confirm">
        <input type="hidden" name="token" value={token} />
        {/* The question is the group's name, so a screen reader says it with the button. */}
        <fieldset className="fieldset">
          <legend className="lc-g3-confirm-text">{labels.explain}</legend>
          <SubmitButton
            pending={pending}
            idle={labels.confirm}
            busy={labels.busy}
            className="btn btn-danger"
          />
        </fieldset>
        <FormMessage result={state} />
      </form>
    </details>
  );
}
