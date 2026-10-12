'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, inviteClientAction } from './actions';
import { InvitationLink } from './invitation-link';

const INITIAL: ActionState = { ok: true, message: '' };

export function ClientInvitationForm({
  organizationId,
  members,
}: {
  readonly organizationId: string;
  readonly members: readonly {
    readonly accountId: string;
    readonly email: string;
    readonly active: boolean;
  }[];
}) {
  const [state, formAction, pending] = useActionState(inviteClientAction, INITIAL);
  const activeMembers = members.filter((m) => m.active);

  if (activeMembers.length === 0) {
    return (
      <p className="card-body">Add at least one active team member before inviting a client.</p>
    );
  }

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="displayName">
          Traveller name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          className="input"
          placeholder="Jane Traveller"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="contactDestination">
          Contact (email or phone)
        </label>
        <input
          id="contactDestination"
          name="contactDestination"
          type="text"
          required
          className="input"
          placeholder="jane@example.com"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="requestedRoute">
          Requested route (optional)
        </label>
        <input
          id="requestedRoute"
          name="requestedRoute"
          type="text"
          className="input"
          placeholder="US B1/B2 business visa"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="caseOwnerAccountId">
          Case owner
        </label>
        <select id="caseOwnerAccountId" name="caseOwnerAccountId" className="input" required>
          {activeMembers.map((m) => (
            <option key={m.accountId} value={m.accountId}>
              {m.email}
            </option>
          ))}
        </select>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Invite client"
          busy="Creating…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
        {state.ok && state.invitationUrl ? <InvitationLink url={state.invitationUrl} /> : null}
      </div>
    </form>
  );
}
