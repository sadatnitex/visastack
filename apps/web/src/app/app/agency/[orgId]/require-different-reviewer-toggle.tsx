'use client';

import { useActionState } from 'react';
import { type ActionState, setRequireDifferentReviewerAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Org admin toggle for Commercial V1 Part 4 §13's optional maker-checker setting on evidence-request decisions. */
export function RequireDifferentReviewerToggle({
  organizationId,
  required,
}: {
  readonly organizationId: string;
  readonly required: boolean;
}) {
  const [state, formAction, pending] = useActionState(setRequireDifferentReviewerAction, INITIAL);
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}
    >
      <form action={formAction}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="required" value={String(!required)} />
        <button
          type="submit"
          className={`btn ${required ? 'btn-secondary' : 'btn-primary'}`}
          style={{ padding: '0.35rem 1rem', fontSize: '0.85rem' }}
          disabled={pending}
        >
          {pending ? 'Saving…' : required ? 'Turn off' : 'Require a different reviewer'}
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
