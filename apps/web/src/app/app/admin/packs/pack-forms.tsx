'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  addRequirementAction,
  createPackAction,
  setDocumentExpiryPolicyAction,
  verifyChecksumAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function CreatePackForm() {
  const [state, formAction, pending] = useActionState(createPackAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor="key">
          Key
        </label>
        <input
          id="key"
          name="key"
          type="text"
          required
          className="input"
          placeholder="e.g. uk.student"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="name">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className="input"
          placeholder="e.g. UK Student Visa"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="description">
          Description (optional)
        </label>
        <input id="description" name="description" type="text" className="input" />
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create pack'}
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

export function AddRequirementForm({
  packId,
  packVersionId,
}: {
  readonly packId: string;
  readonly packVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(addRequirementAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="packVersionId" value={packVersionId} />
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
        <label className="field-label" htmlFor="citation">
          Citation
        </label>
        <input
          id="citation"
          name="citation"
          type="text"
          required
          className="input"
          placeholder="Source rule / URL - required"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="maxAgeDays">
          Max age in days (document only)
        </label>
        <input
          id="maxAgeDays"
          name="maxAgeDays"
          type="number"
          min="1"
          step="1"
          className="input"
          placeholder="e.g. 90 - leave blank for no freshness rule"
        />
      </div>
      <label className="check">
        <input type="checkbox" name="optional" />
        <span>Optional requirement</span>
      </label>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? 'Adding…' : 'Add requirement'}
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

export function VerifyChecksumForm({ packVersionId }: { readonly packVersionId: string }) {
  const [state, formAction, pending] = useActionState(verifyChecksumAction, INITIAL);
  return (
    <form action={formAction} style={{ display: 'inline-block' }}>
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <button
        type="submit"
        className="btn btn-secondary"
        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
        disabled={pending}
      >
        {pending ? 'Verifying…' : 'Verify checksum'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** NTF-01 (Part 5 §1): set/override a docType's expiry-reminder threshold ladder ("configurable by document type"). */
export function SetDocumentExpiryPolicyForm() {
  const [state, formAction, pending] = useActionState(setDocumentExpiryPolicyAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor="expiry-docType">
          Document type
        </label>
        <input
          id="expiry-docType"
          name="docType"
          type="text"
          required
          className="input"
          placeholder="e.g. bank_statement"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="expiry-thresholdDays">
          Reminder thresholds (days, comma-separated)
        </label>
        <input
          id="expiry-thresholdDays"
          name="thresholdDays"
          type="text"
          required
          className="input"
          placeholder="90,60,30,7,0"
        />
      </div>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save thresholds'}
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
