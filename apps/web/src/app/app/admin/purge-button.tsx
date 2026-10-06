'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../components/form-feedback';
import { type ActionState, purgeExpiredDocumentsAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function PurgeButton({ eligibleCount }: { readonly eligibleCount: number }) {
  const [state, formAction, pending] = useActionState(purgeExpiredDocumentsAction, INITIAL);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Queue ${eligibleCount} document${eligibleCount === 1 ? '' : 's'} past retention for deletion? This cannot be undone once the erasure worker verifies the bytes are gone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <SubmitButton
        pending={pending}
        idle={`Queue ${eligibleCount} document${eligibleCount === 1 ? '' : 's'} for deletion`}
        busy="Queuing…"
        className="btn btn-danger"
      />
      <FormMessage result={state} />
    </form>
  );
}
