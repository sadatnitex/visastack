'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { PROFILE_FIELDS } from '../../../../lib/profile-fields';
import { type ActionState, requestEvidenceAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

interface RequestEvidenceFormProps {
  readonly organizationId: string;
  readonly applicants: readonly { readonly applicantId: string; readonly displayName: string }[];
  /** Missions this org can currently reach — lets a mission-scoped-only grant still succeed (Codex review, PR #65). */
  readonly missions?: readonly {
    readonly missionId: string;
    readonly title: string;
    readonly applicantName: string;
  }[];
}

export function RequestEvidenceForm({
  organizationId,
  applicants,
  missions = [],
}: RequestEvidenceFormProps) {
  const [state, formAction, pending] = useActionState(requestEvidenceAction, INITIAL);

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="applicantId">
          Applicant
        </label>
        {applicants.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            No applicant has granted this organization access yet — nothing to request from.
          </p>
        ) : (
          <select id="applicantId" name="applicantId" required className="input" defaultValue="">
            <option value="" disabled>
              Choose an applicant…
            </option>
            {applicants.map((a) => (
              <option key={a.applicantId} value={a.applicantId}>
                {a.displayName}
              </option>
            ))}
          </select>
        )}
      </div>
      {missions.length > 0 ? (
        <div className="field-row">
          <label className="field-label" htmlFor="missionId">
            Case (only needed if this organization's access is limited to one case)
          </label>
          <select id="missionId" name="missionId" className="input" defaultValue="">
            <option value="">Applicant-wide (default)</option>
            {missions.map((m) => (
              <option key={m.missionId} value={m.missionId}>
                {m.applicantName} — {m.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field-row">
        <label className="field-label" htmlFor="kind">
          Kind
        </label>
        <select id="kind" name="kind" className="input" defaultValue="FIELD">
          <option value="FIELD">Field</option>
          <option value="DOCUMENT">Document</option>
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="key">
          Field key / document type
        </label>
        <input
          id="key"
          name="key"
          type="text"
          required
          className="input"
          placeholder="e.g. passport_number or bank_statement"
          list="canonical-field-keys"
        />
        <datalist id="canonical-field-keys">
          {PROFILE_FIELDS.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label}
            </option>
          ))}
        </datalist>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="message">
          Message (optional)
        </label>
        <input
          id="message"
          name="message"
          type="text"
          className="input"
          placeholder="Why you need it"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="dueDate">
          Due date (optional)
        </label>
        <input id="dueDate" name="dueDate" type="date" className="input" />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Request evidence"
          busy="Sending…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
