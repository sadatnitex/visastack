'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  addRequirementAction,
  createPackAction,
  setDocumentExpiryPolicyAction,
  setPublicTrustContentAction,
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
      <div className="field-row">
        <label className="field-label" htmlFor="jurisdiction">
          Jurisdiction (optional)
        </label>
        <input
          id="jurisdiction"
          name="jurisdiction"
          type="text"
          className="input"
          placeholder="e.g. UK"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="route">
          Route (optional)
        </label>
        <input
          id="route"
          name="route"
          type="text"
          className="input"
          placeholder="e.g. Standard Visitor"
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
          placeholder="e.g. tourism"
        />
      </div>
      <label className="check">
        <input type="checkbox" name="authoritative" />
        <span>Authoritative (official source, not an agency's own custom checklist)</span>
      </label>
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

/** Same currency-aware decimal-digit resolution `formatPrice` (lib/usage-format.ts) uses, in reverse -- a plain numeric string suitable for pre-filling an input, never a currency-symbol-bearing display string. */
function minorUnitsToAmountText(minorUnits: number, currency: string): string {
  try {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return (minorUnits / 10 ** digits).toFixed(digits);
  } catch {
    return String(minorUnits / 100);
  }
}

/** Author Public Trust Lite content on a DRAFT version (RUL-06, directive §9). */
export function PublicTrustContentForm({
  packId,
  packVersionId,
  routeDescription,
  officialFeeMinorUnits,
  officialFeeCurrency,
  officialChannelName,
  officialChannelUrl,
  officialReportingUrl,
}: {
  readonly packId: string;
  readonly packVersionId: string;
  readonly routeDescription: string | null;
  readonly officialFeeMinorUnits: number | null;
  readonly officialFeeCurrency: string | null;
  readonly officialChannelName: string | null;
  readonly officialChannelUrl: string | null;
  readonly officialReportingUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(setPublicTrustContentAction, INITIAL);
  const feeAmountDefault =
    officialFeeMinorUnits !== null && officialFeeCurrency !== null
      ? minorUnitsToAmountText(officialFeeMinorUnits, officialFeeCurrency)
      : '';
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <div className="field-row">
        <label className="field-label" htmlFor="routeDescription">
          Route description
        </label>
        <textarea
          id="routeDescription"
          name="routeDescription"
          className="input"
          rows={3}
          defaultValue={routeDescription ?? ''}
          placeholder="A short, maintained description of this route for the public trust page."
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="officialFeeAmount">
          Official fee amount (optional)
        </label>
        <input
          id="officialFeeAmount"
          name="officialFeeAmount"
          type="text"
          inputMode="decimal"
          className="input"
          defaultValue={feeAmountDefault}
          placeholder="e.g. 100.00 - leave both fee fields blank to show none"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="officialFeeCurrency">
          Currency (ISO code)
        </label>
        <input
          id="officialFeeCurrency"
          name="officialFeeCurrency"
          type="text"
          className="input"
          defaultValue={officialFeeCurrency ?? ''}
          placeholder="e.g. GBP"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="officialChannelName">
          Official application channel name
        </label>
        <input
          id="officialChannelName"
          name="officialChannelName"
          type="text"
          className="input"
          defaultValue={officialChannelName ?? ''}
          placeholder="e.g. UK Visas and Immigration"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="officialChannelUrl">
          Official application channel URL
        </label>
        <input
          id="officialChannelUrl"
          name="officialChannelUrl"
          type="url"
          className="input"
          defaultValue={officialChannelUrl ?? ''}
          placeholder="https://www.gov.uk/..."
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="officialReportingUrl">
          Official fraud-reporting URL (optional)
        </label>
        <input
          id="officialReportingUrl"
          name="officialReportingUrl"
          type="url"
          className="input"
          defaultValue={officialReportingUrl ?? ''}
          placeholder="Only if an official one is actually on file - never fabricated"
        />
      </div>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save public trust content'}
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
