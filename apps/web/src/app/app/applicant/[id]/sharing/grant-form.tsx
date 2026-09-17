'use client';

import { useActionState, useState } from 'react';
import { PACK_LABELS, PACK_ORDER } from '../../../../../lib/profile-fields';
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

function toggled(current: readonly string[], value: string, on: boolean): string[] {
  return on ? [...current, value] : current.filter((v) => v !== value);
}

export function GrantForm({
  applicantId,
  documents,
}: {
  readonly applicantId: string;
  readonly documents: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
}) {
  const [state, formAction, pending] = useActionState(createGrantAction, INITIAL);

  // Mirrors the native form's own state purely to drive the live,
  // human-readable summary below (master directive §7 "PR 7" — "before
  // creating a grant, show a human-readable summary"). The inputs
  // themselves stay uncontrolled/native for submission; this is a read-only
  // shadow of what's checked, not the source of truth.
  const [recipientEmail, setRecipientEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [actions, setActions] = useState<readonly string[]>(
    SHAREABLE_ACTIONS.filter((a) => a.defaultOn).map((a) => a.value),
  );
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [selectedDocCount, setSelectedDocCount] = useState(0);
  const [expiryDays, setExpiryDays] = useState('');

  const scopeLabel =
    categories.length === 0
      ? 'every profile category'
      : categories.map((c) => PACK_LABELS[c as keyof typeof PACK_LABELS] ?? c).join(', ');
  const docsLabel =
    documents.length === 0
      ? null
      : selectedDocCount === 0
        ? 'every document'
        : `${selectedDocCount} selected document${selectedDocCount === 1 ? '' : 's'}`;
  const canDownload = actions.includes('DOWNLOAD_REDACTED');

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
          onChange={(e) => setRecipientEmail(e.target.value)}
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
          onChange={(e) => setPurpose(e.target.value)}
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
                onChange={(e) =>
                  setActions((prev) => toggled(prev, action.value, e.target.checked))
                }
              />
              <span>{action.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="fieldset">
        <legend className="field-label">Limit to profile categories (optional)</legend>
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
          Leave all unchecked to share every category. Checking any narrows access to only those.
        </p>
        <div className="checks">
          {PACK_ORDER.map((pack) => (
            <label className="check" key={pack}>
              <input
                type="checkbox"
                name="category"
                value={pack}
                onChange={(e) => setCategories((prev) => toggled(prev, pack, e.target.checked))}
              />
              <span>{PACK_LABELS[pack]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {documents.length > 0 ? (
        <fieldset className="fieldset">
          <legend className="field-label">Limit to specific documents (optional)</legend>
          <p className="muted" style={{ fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
            Leave all unchecked to share every document.
          </p>
          <div className="checks">
            {documents.map((doc) => (
              <label className="check" key={doc.id}>
                <input
                  type="checkbox"
                  name="documentId"
                  value={doc.id}
                  onChange={(e) =>
                    setSelectedDocCount((prev) => prev + (e.target.checked ? 1 : -1))
                  }
                />
                <span>{doc.displayName}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="field-row">
        <label className="field-label" htmlFor="expiryDays">
          Expires after (days)
        </label>
        <input
          id="expiryDays"
          name="expiryDays"
          type="number"
          min="1"
          max="90"
          className="input"
          placeholder="30 (default), up to 90"
          onChange={(e) => setExpiryDays(e.target.value)}
        />
        <p className="muted" style={{ fontSize: '0.75rem', margin: '0.3rem 0 0' }}>
          Every grant expires. Leave blank for the 30-day default; the maximum is 90 days.
        </p>
      </div>

      <div className="notice" aria-live="polite">
        <strong>{recipientEmail || 'This recipient'}</strong> will be able to{' '}
        {actions.length === 0
          ? 'do nothing yet — select at least one permission'
          : actions
              .map((a) => SHAREABLE_ACTIONS.find((s) => s.value === a)?.label.toLowerCase())
              .filter(Boolean)
              .join(', ')}
        {purpose ? <> for “{purpose}”</> : null}, scoped to {scopeLabel}
        {docsLabel ? <> ({docsLabel})</> : null}. {canDownload ? 'Downloading is allowed. ' : ''}
        {expiryDays
          ? `Access expires in ${expiryDays} day${expiryDays === '1' ? '' : 's'}. `
          : 'Access expires in 30 days (the default) unless you set a different duration. '}
        They must accept before anything is visible to them.
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
