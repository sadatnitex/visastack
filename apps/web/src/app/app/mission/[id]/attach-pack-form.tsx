'use client';

import { useActionState } from 'react';
import { type ActionState, attachPackAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export interface PackOption {
  readonly packVersionId: string;
  readonly label: string;
}

export function AttachPackForm({
  missionId,
  options,
}: {
  readonly missionId: string;
  readonly options: readonly PackOption[];
}) {
  const [state, formAction, pending] = useActionState(attachPackAction, INITIAL);

  if (options.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        No published requirement packs are available yet.
      </p>
    );
  }

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <input type="hidden" name="missionId" value={missionId} />
      <select
        name="packVersionId"
        className="input"
        defaultValue=""
        required
        aria-label="Requirement pack"
      >
        <option value="" disabled>
          Choose a requirement pack…
        </option>
        {options.map((opt) => (
          <option key={opt.packVersionId} value={opt.packVersionId}>
            {opt.label}
          </option>
        ))}
      </select>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Attaching…' : 'Attach pack'}
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
