'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useLatestResultArea } from '../../../../components/latest-result';
import { type ActionState, addMemberAction } from './actions';
import { InvitationLink } from './invitation-link';

const INITIAL: ActionState = { ok: true, message: '' };

export function AddMemberForm({ organizationId }: { readonly organizationId: string }) {
  // Inside a Team or Clients panel the panel says what happened, once, for the latest action.
  const area = useLatestResultArea<ActionState>();
  const [state, formAction, pending] = useActionState(
    area ? area.track(addMemberAction) : addMemberAction,
    INITIAL,
  );
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="memberEmail">
          Member Email
        </label>
        <input
          id="memberEmail"
          name="memberEmail"
          type="email"
          required
          className="input"
          placeholder="teammate@example.com"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="role">
          Role
        </label>
        <select id="role" name="role" className="input" defaultValue="REVIEWER">
          <option value="ADMIN">Admin</option>
          <option value="CASE_MANAGER">Case Manager</option>
          <option value="REVIEWER">Reviewer</option>
        </select>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Add Member"
          busy="Adding…"
          className="btn btn-secondary"
        />
        {area ? null : (
          <>
            <FormMessage result={state} />
            {state.ok && state.invitationUrl ? <InvitationLink url={state.invitationUrl} /> : null}
          </>
        )}
      </div>
    </form>
  );
}
