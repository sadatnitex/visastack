'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../components/form-feedback';
import {
  type ActionState,
  createInvitationAction,
  grantPlatformRoleAction,
  placeLegalHoldAction,
  setRetentionPolicyAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(createInvitationAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor="inviteEmail">
          Email
        </label>
        <input
          id="inviteEmail"
          name="email"
          type="email"
          required
          className="input"
          placeholder="person@example.com"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="inviteReason">
          Reason (optional)
        </label>
        <input
          id="inviteReason"
          name="reason"
          type="text"
          className="input"
          placeholder="e.g. internal tester, partner agency contact"
        />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Invite"
          busy="Inviting…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

const PLATFORM_ROLE_OPTIONS = [
  { value: 'PLATFORM_OWNER', label: 'Platform owner' },
  { value: 'SECURITY_ADMIN', label: 'Security admin' },
  { value: 'COMPLIANCE_ADMIN', label: 'Compliance admin' },
  { value: 'SUPPORT_ADMIN', label: 'Support admin' },
] as const;

export function GrantRoleForm() {
  const [state, formAction, pending] = useActionState(grantPlatformRoleAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor="targetEmail">
          Email
        </label>
        <input
          id="targetEmail"
          name="targetEmail"
          type="email"
          required
          className="input"
          placeholder="person@example.com"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="role">
          Role
        </label>
        <select id="role" name="role" required className="input" defaultValue="">
          <option value="" disabled>
            Choose a role…
          </option>
          {PLATFORM_ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="grantReason">
          Reason
        </label>
        <input
          id="grantReason"
          name="reason"
          type="text"
          required
          className="input"
          placeholder="Why this role is being granted"
        />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Grant role"
          busy="Granting…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

export function RetentionPolicyForm() {
  const [state, formAction, pending] = useActionState(setRetentionPolicyAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor="docType">
          Document type
        </label>
        <input
          id="docType"
          name="docType"
          type="text"
          required
          className="input"
          placeholder="e.g. bank_statement"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="retentionDays">
          Retention (days)
        </label>
        <input
          id="retentionDays"
          name="retentionDays"
          type="number"
          min="1"
          required
          className="input"
          placeholder="e.g. 365"
        />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Set policy"
          busy="Saving…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

interface LegalHoldFormProps {
  readonly applicants: readonly { readonly id: string; readonly displayName: string }[];
}

export function LegalHoldForm({ applicants }: LegalHoldFormProps) {
  const [state, formAction, pending] = useActionState(placeLegalHoldAction, INITIAL);
  const [scope, setScope] = useState<'applicant' | 'mission' | 'document'>('applicant');
  return (
    <form action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor="applicantId">
          Applicant
        </label>
        {applicants.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            No applicants exist yet.
          </p>
        ) : (
          <select id="applicantId" name="applicantId" required className="input" defaultValue="">
            <option value="" disabled>
              Choose an applicant…
            </option>
            {applicants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="reason">
          Reason
        </label>
        <input
          id="reason"
          name="reason"
          type="text"
          required
          className="input"
          placeholder="Why the hold is placed"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="reviewAt">
          Review by
        </label>
        <input id="reviewAt" name="reviewAt" type="date" required className="input" />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="scope">
          Scope
        </label>
        <select
          id="scope"
          name="scope"
          className="input"
          defaultValue="applicant"
          onChange={(e) => setScope(e.target.value as 'applicant' | 'mission' | 'document')}
        >
          <option value="applicant">Whole applicant (default)</option>
          <option value="mission">One case only</option>
          <option value="document">One document only</option>
        </select>
      </div>
      {scope === 'mission' ? (
        <div className="field-row">
          <label className="field-label" htmlFor="missionId">
            Case ID
          </label>
          <input
            id="missionId"
            name="missionId"
            type="text"
            required
            className="input"
            placeholder="UUID, from the case's own page"
          />
        </div>
      ) : null}
      {scope === 'document' ? (
        <div className="field-row">
          <label className="field-label" htmlFor="documentId">
            Document ID
          </label>
          <input
            id="documentId"
            name="documentId"
            type="text"
            required
            className="input"
            placeholder="UUID, from the document's own page"
          />
        </div>
      ) : null}
      <div>
        <SubmitButton
          pending={pending}
          idle="Place legal hold"
          busy="Placing…"
          className="btn btn-danger"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
