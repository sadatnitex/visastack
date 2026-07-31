'use client';

import { useActionState } from 'react';
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
          <button type="submit" className="btn btn-secondary" disabled={dryRunPending}>
            {dryRunPending ? 'Scanning…' : 'Scan for drift (dry run)'}
          </button>
        </form>
        <form
          action={mutateAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                'Clean up dangling references now? This only removes metadata rows with no backing bytes and no remaining document — it never deletes bytes that still exist.',
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="mode" value="mutate" />
          <button type="submit" className="btn btn-danger" disabled={mutatePending}>
            {mutatePending ? 'Cleaning…' : 'Clean up dangling references'}
          </button>
        </form>
      </div>
      {dryRunState.message ? (
        <p className={`field-msg ${dryRunState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {dryRunState.message}
        </p>
      ) : null}
      {mutateState.message ? (
        <p className={`field-msg ${mutateState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {mutateState.message}
        </p>
      ) : null}
    </div>
  );
}
