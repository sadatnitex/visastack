'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
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
  const [state, formAction, pending] = useActionState(toggleMemberAction, INITIAL);
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
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}
