'use client';

import { useActionState } from 'react';
import { SubmitButton } from '../../../../components/form-feedback';
import { type ActionState, inviteClientAction } from './actions';
import { InvitationOutcome } from './invitation-outcome';

const INITIAL: ActionState = { ok: true, message: '' };

export function ClientInvitationForm({
  organizationId,
  members,
  pendingInvitationIds,
}: {
  readonly organizationId: string;
  /** Invitations still waiting, as the page last read them. */
  readonly pendingInvitationIds: readonly string[];
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
          Traveller Name
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
          Client Email Address
        </label>
        <input
          id="contactDestination"
          name="contactDestination"
          type="email"
          autoComplete="off"
          aria-describedby="contactDestination-hint"
          required
          className="input"
          placeholder="jane@example.com"
        />
        <p id="contactDestination-hint" className="disclosure-hint">
          Only someone signed in with this email address can accept the invitation.
        </p>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="requestedRoute">
          Requested Route (Optional)
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
          Case Owner
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
          idle="Invite Client"
          busy="Creating…"
          className="btn btn-primary"
        />
        <InvitationOutcome state={state} pendingInvitationIds={pendingInvitationIds} />
      </div>
    </form>
  );
}
