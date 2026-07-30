'use client';

import { useActionState } from 'react';
import { type ActionState, createApplicantAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function AddApplicantForm() {
  const [state, formAction, pending] = useActionState(createApplicantAction, INITIAL);
  return (
    <form
      action={formAction}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}
    >
      <div>
        <label className="field-label" htmlFor="displayName">
          Full name
        </label>
        <input
          id="displayName"
          name="displayName"
          placeholder="Full name"
          required
          className="input"
          style={{ width: '100%', marginTop: '0.35rem' }}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="relationship">
          Relationship
        </label>
        <select
          id="relationship"
          name="relationship"
          defaultValue="SELF"
          className="input"
          style={{ width: '100%', marginTop: '0.35rem' }}
        >
          <option value="SELF">Myself</option>
          <option value="FAMILY_MEMBER">Family member</option>
          <option value="MINOR_GUARDIAN">Minor (guardian)</option>
        </select>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Adding…' : 'Add applicant'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
