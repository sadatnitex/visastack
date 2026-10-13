'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../components/form-feedback';
import { type ActionState, reconcileOrphansAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function ReconcileButtons() {
  const [dryRunState, dryRunAction, dryRunPending] = useActionState(
    reconcileOrphansAction,
    INITIAL,
  );
  const [mutateState, mutateAction, mutatePending] = useActionState(
    reconcileOrphansAction,
    INITIAL,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <form action={dryRunAction}>
          <input type="hidden" name="mode" value="dry-run" />
          <SubmitButton
            pending={dryRunPending}
            idle="Scan for drift (dry run)"
            busy="Scanning…"
            className="btn btn-secondary"
          />
        </form>
        <form
          action={mutateAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                'Clean up dangling references now? This only removes metadata rows with no backing bytes and no remaining document. It never deletes bytes that still exist.',
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="mode" value="mutate" />
          <SubmitButton
            pending={mutatePending}
            idle="Clean up dangling references"
            busy="Cleaning…"
            className="btn btn-danger"
          />
        </form>
      </div>
      <FormMessage result={dryRunState} />
      <FormMessage result={mutateState} />
    </div>
  );
}
