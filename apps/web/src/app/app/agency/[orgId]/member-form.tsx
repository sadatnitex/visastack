'use client';

import { useActionState } from 'react';
import { SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, addMemberAction } from './actions';
import { InvitationOutcome } from './invitation-outcome';

const INITIAL: ActionState = { ok: true, message: '' };

export function AddMemberForm({
  organizationId,
  pendingInvitationIds,
}: {
  readonly organizationId: string;
  /** Invitations still waiting, as the page last read them. */
  readonly pendingInvitationIds: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(addMemberAction, INITIAL);
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
          className="btn btn-primary"
        />
        <InvitationOutcome state={state} pendingInvitationIds={pendingInvitationIds} />
      </div>
    </form>
  );
}
