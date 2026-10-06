'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, acceptClientInvitationAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * The explicit, deliberate confirmation itself (directive Part 4 §6): the
 * traveller, never the agency, picks which of their own applicant profiles
 * the resulting case and grant attach to. Submitting this is what actually
 * consumes the token and creates the grant, never the page render above it.
 */
export function AcceptClientInvitationForm({
  token,
  applicants,
}: {
  readonly token: string;
  readonly applicants: readonly { readonly id: string; readonly displayName: string }[];
}) {
  const [state, formAction, pending] = useActionState(acceptClientInvitationAction, INITIAL);
  const [selection, setSelection] = useState('new');

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="token" value={token} />
      <div className="field-row">
        <span className="field-label">Which profile?</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="radio"
              name="applicantSelection"
              value="new"
              checked={selection === 'new'}
              onChange={() => setSelection('new')}
            />
            Create a new profile
          </label>
          {applicants.map((a) => (
            <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="radio"
                name="applicantSelection"
                value={a.id}
                checked={selection === a.id}
                onChange={() => setSelection(a.id)}
              />
              {a.displayName}
            </label>
          ))}
        </div>
      </div>
      {selection === 'new' ? (
        <div className="field-row">
          <label className="field-label" htmlFor="newDisplayName">
            Profile name (optional)
          </label>
          <input
            id="newDisplayName"
            name="newDisplayName"
            type="text"
            className="input"
            placeholder="Leave blank to use the name the agency gave"
          />
        </div>
      ) : null}
      <div>
        <SubmitButton
          pending={pending}
          idle="Grant access"
          busy="Granting access…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
