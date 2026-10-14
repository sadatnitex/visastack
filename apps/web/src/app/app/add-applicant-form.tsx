'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../components/form-feedback';
import { type ActionState, createApplicantAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function AddApplicantForm() {
  const [state, formAction, pending] = useActionState(createApplicantAction, INITIAL);
  const [relationship, setRelationship] = useState('SELF');
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  useFocusInvalidField(formRef, state);
  const needsAuthority = relationship !== 'SELF';

  return (
    <form
      ref={formRef}
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
          {...fieldProblem(state, 'displayName', messageId)}
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
            fontSize: 'var(--text-small)',
          }}
        >
          <input
            type="checkbox"
            name="authorityConfirmed"
            value="true"
            required
            {...fieldProblem(state, 'authorityConfirmed', messageId)}
          />
          <span>
            I confirm I have authority to create and manage this record on their behalf. This is
            never assumed from a shared name or address.
          </span>
        </label>
      ) : null}
      <SubmitButton
        pending={pending}
        idle="Add applicant"
        busy="Adding…"
        className="btn btn-primary"
      />
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
