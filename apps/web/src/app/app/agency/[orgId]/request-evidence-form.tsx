'use client';

import { useActionState } from 'react';
import { type ActionState, requestEvidenceAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function RequestEvidenceForm({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(requestEvidenceAction, INITIAL);

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="applicantId">
          Applicant ID
        </label>
        <input
          id="applicantId"
          name="applicantId"
          type="text"
          required
          className="input"
          placeholder="The applicant's ID"
        />
      </div>
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
        />
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
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Sending…' : 'Request evidence'}
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
