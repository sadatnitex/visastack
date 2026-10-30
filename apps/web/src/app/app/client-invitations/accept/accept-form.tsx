'use client';

import { useActionState, useId, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { AGENCY_AI_CHOICE_LABEL, agencyAiTravellerNote } from '../../../../lib/agency-ai';
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
  agencyAi,
}: {
  readonly token: string;
  readonly applicants: readonly { readonly id: string; readonly displayName: string }[];
  /** S22: offer "Let This Agency Use AI Tools on What I Share", unticked, once it can be stored. */
  readonly agencyAi?: { readonly agencyName: string };
}) {
  const [state, formAction, pending] = useActionState(acceptClientInvitationAction, INITIAL);
  const [selection, setSelection] = useState('new');
  const aiId = useId();

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
            Create a New Profile
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
            Profile Name (Optional)
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
      {agencyAi ? (
        <fieldset className="fieldset">
          <legend className="field-label">AI Tools</legend>
          <div className="checks">
            <label className="check" htmlFor={`${aiId}-allow`}>
              <input
                id={`${aiId}-allow`}
                type="checkbox"
                name="allowAgencyAi"
                aria-describedby={`${aiId}-note`}
              />
              <span>{AGENCY_AI_CHOICE_LABEL}</span>
            </label>
          </div>
          <small className="muted" id={`${aiId}-note`}>
            {agencyAiTravellerNote(agencyAi.agencyName)} You will be asked to confirm it is you.
          </small>
        </fieldset>
      ) : null}
      <div>
        <SubmitButton
          pending={pending}
          idle="Grant Access"
          busy="Granting access…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
