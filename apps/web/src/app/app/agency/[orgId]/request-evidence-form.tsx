'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { DOCUMENT_TYPE_LABELS } from '../../../../lib/labels';
import { PACK_LABELS, PROFILE_FIELDS } from '../../../../lib/profile-fields';
import { type ActionState, requestEvidenceAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Profile details grouped by the part of the profile they belong to, in registry order. */
const FIELD_GROUPS = Array.from(new Set(PROFILE_FIELDS.map((f) => f.pack))).map((pack) => ({
  pack,
  fields: PROFILE_FIELDS.filter((f) => f.pack === pack),
}));

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
  const [kind, setKind] = useState<'FIELD' | 'DOCUMENT'>('FIELD');

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="applicantId">
          Applicant
        </label>
        {applicants.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            No applicant has granted this organization access yet. Nothing to request from.
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
                {m.applicantName}: {m.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field-row">
        <label className="field-label" htmlFor="kind">
          What do you need?
        </label>
        <select
          id="kind"
          name="kind"
          className="input"
          value={kind}
          onChange={(event) => setKind(event.target.value === 'DOCUMENT' ? 'DOCUMENT' : 'FIELD')}
        >
          <option value="FIELD">A detail from the profile</option>
          <option value="DOCUMENT">A document</option>
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="key">
          {kind === 'FIELD' ? 'Which detail?' : 'Which document?'}
        </label>
        {kind === 'FIELD' ? (
          <select id="key" name="key" required className="input" defaultValue="" key="field-key">
            <option value="" disabled>
              Choose a detail…
            </option>
            {FIELD_GROUPS.map((group) => (
              <optgroup key={group.pack} label={PACK_LABELS[group.pack]}>
                {group.fields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <select id="key" name="key" required className="input" defaultValue="" key="document-key">
            <option value="" disabled>
              Choose a document…
            </option>
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        )}
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
          placeholder="For example: needed for the visa form"
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
