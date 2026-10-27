'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useLatestResultArea } from '../../../../components/latest-result';
import { type ActionState, toggleMemberAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function MemberToggleButton({
  organizationId,
  membershipId,
  active,
}: {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly active: boolean;
}) {
  // Inside a Team or Clients panel the panel says what happened, once, for the latest action.
  const area = useLatestResultArea<ActionState>();
  const [state, formAction, pending] = useActionState(
    area ? area.track(toggleMemberAction) : toggleMemberAction,
    INITIAL,
  );
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}
    >
      <form
        action={formAction}
        onSubmit={(e) => {
          if (active && !window.confirm('Deactivate this member? They lose access immediately.')) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="membershipId" value={membershipId} />
        <input type="hidden" name="active" value={String(!active)} />
        <SubmitButton
          pending={pending}
          idle={active ? 'Deactivate' : 'Reactivate'}
          busy="Updating…"
          className="btn btn-secondary u-btn-sm"
        />
      </form>
      {area ? null : <FormMessage result={state} />}
    </div>
  );
}
