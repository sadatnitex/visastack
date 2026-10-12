'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, addMemberAction } from './actions';
import { InvitationLink } from './invitation-link';

const INITIAL: ActionState = { ok: true, message: '' };

export function AddMemberForm({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(addMemberAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="memberEmail">
          Member email
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
          <option value="CASE_MANAGER">Case manager</option>
          <option value="REVIEWER">Reviewer</option>
        </select>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Add member"
          busy="Adding…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
        {state.ok && state.invitationUrl ? <InvitationLink url={state.invitationUrl} /> : null}
      </div>
    </form>
  );
}
