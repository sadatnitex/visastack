'use client';

import { useActionState } from 'react';
import { type ActionState, createMissionAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function CreateMissionForm({ applicantId }: { readonly applicantId: string }) {
  const [state, formAction, pending] = useActionState(createMissionAction, INITIAL);

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="applicantId" value={applicantId} />
      <div className="field-row">
        <label className="field-label" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          className="input"
          placeholder="e.g. UK Student Visa — Autumn 2026"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="destination">
          Destination (optional)
        </label>
        <input
          id="destination"
          name="destination"
          type="text"
          className="input"
          placeholder="e.g. United Kingdom"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="purpose">
          Purpose (optional)
        </label>
        <input
          id="purpose"
          name="purpose"
          type="text"
          className="input"
          placeholder="e.g. Postgraduate study"
        />
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create mission'}
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
