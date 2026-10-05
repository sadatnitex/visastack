'use client';

import { useActionState, useState } from 'react';
import { type ActionState, createApplicantAction } from './actions';
import type { AddApplicantMessages } from './add-applicant-form.messages';

const INITIAL: ActionState = { ok: true, message: '' };

export function AddApplicantForm({ messages }: { readonly messages: AddApplicantMessages }) {
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
          {messages['account.add.name']}
        </label>
        <input
          id="displayName"
          name="displayName"
          placeholder={messages['account.add.name']}
          required
          className="input"
          style={{ width: '100%', marginTop: '0.35rem' }}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="relationship">
          {messages['account.add.relationship']}
        </label>
        <select
          id="relationship"
          name="relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          className="input"
          style={{ width: '100%', marginTop: '0.35rem' }}
        >
          <option value="SELF">{messages['applicant.relationship.self']}</option>
          <option value="FAMILY_MEMBER">{messages['applicant.relationship.familyMember']}</option>
          <option value="MINOR_GUARDIAN">{messages['applicant.relationship.minorGuardian']}</option>
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
          <span>{messages['consent.authority.confirm']}</span>
        </label>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? messages['account.add.submitting'] : messages['account.add.submit']}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
