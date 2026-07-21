'use client';

import { useActionState } from 'react';
import { type ActionState, cancelDeletionAction, requestDeletionAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

interface DeletionPanelProps {
  /** ISO date the pending deletion is scheduled for, or null if none pending. */
  readonly scheduledFor: string | null;
}

export function DeletionPanel({ scheduledFor }: DeletionPanelProps) {
  const [reqState, requestAction, reqPending] = useActionState(requestDeletionAction, INITIAL);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelDeletionAction, INITIAL);

  if (scheduledFor) {
    const when = new Date(scheduledFor).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return (
      <div>
        <div className="notice notice-warn" style={{ marginBottom: '1rem' }}>
          <strong>Deletion pending.</strong> Your account and all owned data are scheduled for
          permanent deletion on {when}. Cancel any time before then to keep your account.
        </div>
        <form action={cancelAction}>
          <button type="submit" className="btn btn-primary" disabled={cancelPending}>
            {cancelPending ? 'Cancelling…' : 'Cancel deletion'}
          </button>
        </form>
        {cancelState.message ? (
          <p className={`field-msg ${cancelState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
            {cancelState.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={requestAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Schedule permanent deletion of your account and all owned data? You will have a 7-day grace window to cancel.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <label
        className="field-label"
        htmlFor="del-reason"
        style={{ display: 'block', marginBottom: '0.4rem' }}
      >
        Reason (optional)
      </label>
      <input
        id="del-reason"
        name="reason"
        type="text"
        className="input"
        placeholder="Helps us improve — not required"
        style={{ marginBottom: '0.85rem' }}
      />
      <button type="submit" className="btn btn-danger" disabled={reqPending}>
        {reqPending ? 'Scheduling…' : 'Request account deletion'}
      </button>
      {reqState.message ? (
        <p className={`field-msg ${reqState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {reqState.message}
        </p>
      ) : null}
    </form>
  );
}
