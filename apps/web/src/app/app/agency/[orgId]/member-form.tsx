'use client';

import { useActionState } from 'react';
import { type ActionState, addMemberAction } from './actions';

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
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? 'Adding…' : 'Add member'}
        </button>
        {state.message ? (
          <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
