'use client';

import { useActionState } from 'react';
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
      <button type="submit" className="btn btn-danger" disabled={pending}>
        {pending
          ? 'Queuing…'
          : `Queue ${eligibleCount} document${eligibleCount === 1 ? '' : 's'} for deletion`}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
