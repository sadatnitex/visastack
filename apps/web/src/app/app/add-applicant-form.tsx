'use client';

import { useActionState, useState } from 'react';
import { type ActionState, createApplicantAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function AddApplicantForm() {
  const [state, formAction, pending] = useActionState(createApplicantAction, INITIAL);
  const [relationship, setRelationship] = useState('SELF');
  const needsAuthority = relationship !== 'SELF';

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
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          className="input"
          style={{ width: '100%', marginTop: '0.35rem' }}
        >
          <option value="SELF">Myself</option>
          <option value="FAMILY_MEMBER">Family member</option>
          <option value="MINOR_GUARDIAN">Minor (guardian)</option>
        </select>
      </div>
      {needsAuthority ? (
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            fontSize: '0.85rem',
          }}
        >
          <input type="checkbox" name="authorityConfirmed" value="true" required />
          <span>
            I confirm I have authority to create and manage this record on their behalf. This is
            never assumed from a shared name or address.
          </span>
        </label>
      ) : null}
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
