'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import type { ChoiceGroup } from '../../../../lib/master-profile-types';
import { type ActionState, requestEvidenceAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Chosen from the document list when the document is not one the product names yet. */
const OTHER_DOCUMENT = '__other__';

interface RequestEvidenceFormProps {
  readonly organizationId: string;
  /** Every detail that can be asked for, grouped by part of the profile. Built on the server. */
  readonly fieldGroups: readonly ChoiceGroup[];
  /** Every document type that can be asked for, grouped. Built on the server. */
  readonly documentGroups: readonly ChoiceGroup[];
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
  fieldGroups,
  documentGroups,
  applicants,
  missions = [],
}: RequestEvidenceFormProps) {
  const [state, formAction, pending] = useActionState(requestEvidenceAction, INITIAL);
  const [kind, setKind] = useState<'FIELD' | 'DOCUMENT'>('FIELD');
  const [documentChoice, setDocumentChoice] = useState('');

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="field-row">
        <label className="field-label" htmlFor="applicantId">
          Applicant
        </label>
        {applicants.length === 0 ? (
          <p className="muted u-fs-085">
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
            <option value="">Applicant-Wide (Default)</option>
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
          <option value="FIELD">A Detail from the Profile</option>
          <option value="DOCUMENT">A Document</option>
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
            {fieldGroups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.choices.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <>
            <select
              id="key"
              required
              className="input"
              value={documentChoice}
              onChange={(event) => setDocumentChoice(event.target.value)}
            >
              <option value="" disabled>
                Choose a document…
              </option>
              {documentGroups.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.choices.map((document) => (
                    <option key={document.key} value={document.key}>
                      {document.label}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={OTHER_DOCUMENT}>Something Else (Type Its Name)</option>
            </select>
            {documentChoice === OTHER_DOCUMENT ? (
              <input
                id="otherDocument"
                name="key"
                type="text"
                required
                className="input"
                aria-label="Name of the other document"
                placeholder="For example: Marriage Certificate"
              />
            ) : (
              <input type="hidden" name="key" value={documentChoice} />
            )}
          </>
        )}
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="message">
          Message (Optional)
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
          Due Date (Optional)
        </label>
        <input id="dueDate" name="dueDate" type="date" className="input" />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Request Evidence"
          busy="Sending…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
