'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  grantPlatformRoleAction,
  placeLegalHoldAction,
  setRetentionPolicyAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

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
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Granting…' : 'Grant role'}
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
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Set policy'}
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

interface LegalHoldFormProps {
  readonly applicants: readonly { readonly id: string; readonly displayName: string }[];
}

export function LegalHoldForm({ applicants }: LegalHoldFormProps) {
  const [state, formAction, pending] = useActionState(placeLegalHoldAction, INITIAL);
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
      <div>
        <button type="submit" className="btn btn-danger" disabled={pending}>
          {pending ? 'Placing…' : 'Place legal hold'}
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
