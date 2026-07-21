'use client';

import { useActionState } from 'react';
import { type ActionState, createGrantAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Curated, launch-safe permission set (read + collaborate; no original download / manage). */
const SHAREABLE_ACTIONS: ReadonlyArray<{ value: string; label: string; defaultOn?: boolean }> = [
  { value: 'VIEW_METADATA', label: 'View metadata', defaultOn: true },
  { value: 'PREVIEW', label: 'Preview documents', defaultOn: true },
  { value: 'DOWNLOAD_REDACTED', label: 'Download redacted copies' },
  { value: 'COMMENT', label: 'Comment' },
  { value: 'PROPOSE_EDIT', label: 'Propose edits' },
];

export function GrantForm({ applicantId }: { readonly applicantId: string }) {
  const [state, formAction, pending] = useActionState(createGrantAction, INITIAL);

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="applicantId" value={applicantId} />

      <div className="field-row">
        <label className="field-label" htmlFor="recipientEmail">
          Recipient email
        </label>
        <input
          id="recipientEmail"
          name="recipientEmail"
          type="email"
          required
          className="input"
          placeholder="them@example.com"
        />
      </div>

      <div className="field-row">
        <label className="field-label" htmlFor="purpose">
          Purpose
        </label>
        <input
          id="purpose"
          name="purpose"
          type="text"
          required
          className="input"
          placeholder="e.g. Review my UK student visa documents"
        />
      </div>

      <fieldset className="fieldset">
        <legend className="field-label">Permissions</legend>
        <div className="checks">
          {SHAREABLE_ACTIONS.map((action) => (
            <label className="check" key={action.value}>
              <input
                type="checkbox"
                name="action"
                value={action.value}
                defaultChecked={action.defaultOn ?? false}
              />
              <span>{action.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field-row">
        <label className="field-label" htmlFor="expiryDays">
          Expires after (days, optional)
        </label>
        <input
          id="expiryDays"
          name="expiryDays"
          type="number"
          min="1"
          className="input"
          placeholder="Leave blank for no expiry"
        />
      </div>

      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Sharing…' : 'Share access'}
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
