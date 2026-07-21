'use client';

import { useActionState } from 'react';
import { PROFILE_FIELDS } from '../../../../lib/profile-fields';
import { type ActionState, saveFactAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const STATUS_LABELS: Record<string, string> = {
  DECLARED: 'Declared',
  APPLICANT_CONFIRMED: 'Confirmed',
  DOCUMENT_SUPPORTED: 'Document-supported',
  AGENCY_REVIEWED: 'Agency-reviewed',
  CONFLICTED: 'Conflicted',
  STALE: 'Stale',
};

interface FieldRowProps {
  readonly applicantId: string;
  readonly fieldKey: string;
  readonly label: string;
  readonly type?: 'text' | 'date';
  readonly placeholder?: string;
  readonly currentValue: string | null;
  readonly status: string | null;
}

function FieldRow({
  applicantId,
  fieldKey,
  label,
  type,
  placeholder,
  currentValue,
  status,
}: FieldRowProps) {
  const [state, formAction, pending] = useActionState(saveFactAction, INITIAL);

  return (
    <form action={formAction} className="field-row">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="fieldKey" value={fieldKey} />
      <div className="field-head">
        <label className="field-label" htmlFor={`f-${fieldKey}`}>
          {label}
        </label>
        {status ? (
          <span className="badge badge-neutral">{STATUS_LABELS[status] ?? status}</span>
        ) : null}
      </div>
      <div className="field-control">
        <input
          id={`f-${fieldKey}`}
          name="value"
          type={type === 'date' ? 'date' : 'text'}
          defaultValue={currentValue ?? ''}
          placeholder={placeholder ?? ''}
          className="input"
        />
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

interface ProfileEditorProps {
  readonly applicantId: string;
  readonly values: Readonly<Record<string, { value: string | null; status: string | null }>>;
}

export function ProfileEditor({ applicantId, values }: ProfileEditorProps) {
  return (
    <div className="field-list">
      {PROFILE_FIELDS.map((field) => {
        const current = values[field.key];
        return (
          <FieldRow
            key={field.key}
            applicantId={applicantId}
            fieldKey={field.key}
            label={field.label}
            {...(field.type ? { type: field.type } : {})}
            {...(field.placeholder ? { placeholder: field.placeholder } : {})}
            currentValue={current?.value ?? null}
            status={current?.status ?? null}
          />
        );
      })}
    </div>
  );
}
