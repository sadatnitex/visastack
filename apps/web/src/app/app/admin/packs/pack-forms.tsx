'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import {
  type ActionState,
  addRequirementAction,
  createPackAction,
  recordRequirementSourceReviewAction,
  setDocumentExpiryPolicyAction,
  setPublicTrustContentAction,
  verifyChecksumAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function CreatePackForm() {
  const [state, formAction, pending] = useActionState(createPackAction, INITIAL);
  return (
    <form action={formAction} className="field-list form-narrow">
      <fieldset className="form-section">
        <legend>Pack Details</legend>
        <div className="form-grid">
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
          <div className="field-row field-wide">
            <label className="field-label" htmlFor="description">
              Description (Optional)
            </label>
            <input id="description" name="description" type="text" className="input" />
          </div>
          <label className="check field-wide">
            <input type="checkbox" name="authoritative" />
            <span>Authoritative (official source, not an agency's own custom checklist)</span>
          </label>
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>Where It Applies</legend>
        <div className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="jurisdiction">
              Jurisdiction (Optional)
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
              Route (Optional)
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
              Purpose (Optional)
            </label>
            <input
              id="purpose"
              name="purpose"
              type="text"
              className="input"
              placeholder="e.g. tourism"
            />
          </div>
        </div>
      </fieldset>
      <div>
        <SubmitButton
          pending={pending}
          idle="Create Pack"
          busy="Creating…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
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
  const [kind, setKind] = useState<'FIELD' | 'DOCUMENT'>('FIELD');
  return (
    <form action={formAction} className="field-list form-narrow">
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <fieldset className="form-section">
        <legend>Requirement</legend>
        <div className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="kind">
              Kind
            </label>
            <select
              id="kind"
              name="kind"
              className="input"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value === 'DOCUMENT' ? 'DOCUMENT' : 'FIELD')
              }
            >
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
              list={kind === 'FIELD' ? 'catalogue-field-keys' : 'catalogue-document-types'}
              placeholder={kind === 'FIELD' ? 'e.g. passport_number' : 'e.g. Bank Statement'}
            />
          </div>
          <div className="field-row field-wide">
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
              Max Age in Days (Document Only)
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
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>Official Source</legend>
        <p className="muted">
          Official requirement packs need a source link, title, publisher and checked date before
          approval. Custom checklists keep the manual approval path.
        </p>
        <div className="form-grid">
          {[
            { name: 'sourceUrl', label: 'Source Link', type: 'url', maxLength: 2048 },
            { name: 'sourceTitle', label: 'Source Title', type: 'text', maxLength: 240 },
            { name: 'publisher', label: 'Publisher', type: 'text', maxLength: 160 },
            { name: 'observedDate', label: 'Date Source Checked', type: 'date', maxLength: 10 },
          ].map((field) => (
            <div className="field-row" key={field.name}>
              <label className="field-label" htmlFor={field.name}>
                {field.label}
              </label>
              <input
                id={field.name}
                name={field.name}
                type={field.type}
                className="input"
                maxLength={field.maxLength}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <div>
        <SubmitButton
          pending={pending}
          idle="Add Requirement"
          busy="Adding…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

export function RequirementSourceReviewForm({
  packId,
  requirementId,
  sourceUrl,
  sourceTitle,
  publisher,
  observedDate,
}: {
  readonly packId: string;
  readonly requirementId: string;
  readonly sourceUrl: string | null;
  readonly sourceTitle: string | null;
  readonly publisher: string | null;
  readonly observedDate: string;
}) {
  const [state, formAction, pending] = useActionState(recordRequirementSourceReviewAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="requirementId" value={requirementId} />
      <p className="muted">
        Record the source you checked. Official packs still require a separate reviewer to approve
        the version.
      </p>
      <div className="form-grid">
        {[
          {
            name: 'sourceUrl',
            label: 'Source Link',
            type: 'url',
            value: sourceUrl ?? '',
            maxLength: 2048,
          },
          {
            name: 'sourceTitle',
            label: 'Source Title',
            type: 'text',
            value: sourceTitle ?? '',
            maxLength: 240,
          },
          {
            name: 'publisher',
            label: 'Publisher',
            type: 'text',
            value: publisher ?? '',
            maxLength: 160,
          },
          {
            name: 'observedDate',
            label: 'Date Source Checked',
            type: 'date',
            value: observedDate,
            maxLength: 10,
          },
        ].map((field) => (
          <div className="field-row" key={field.name}>
            <label className="field-label" htmlFor={`${requirementId}-${field.name}`}>
              {field.label}
            </label>
            <input
              id={`${requirementId}-${field.name}`}
              name={field.name}
              type={field.type}
              required
              defaultValue={field.value}
              maxLength={field.maxLength}
              className="input"
            />
          </div>
        ))}
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Save Source Review"
          busy="Saving…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

export function VerifyChecksumForm({ packVersionId }: { readonly packVersionId: string }) {
  const [state, formAction, pending] = useActionState(verifyChecksumAction, INITIAL);
  return (
    <form action={formAction} style={{ display: 'inline-block' }}>
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <SubmitButton
        pending={pending}
        idle="Verify Checksum"
        busy="Verifying…"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage result={state} />
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
    <form action={formAction} className="field-list form-narrow">
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <fieldset className="form-section">
        <legend>Route and Fee</legend>
        <div className="form-grid">
          <div className="field-row field-wide">
            <label className="field-label" htmlFor="routeDescription">
              Route Description
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
              Official Fee Amount (Optional)
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
              Currency (ISO Code)
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
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>Official Channels</legend>
        <div className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="officialChannelName">
              Official Application Channel Name
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
              Official Application Channel URL
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
          <div className="field-row field-wide">
            <label className="field-label" htmlFor="officialReportingUrl">
              Official Fraud-Reporting URL (Optional)
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
        </div>
      </fieldset>
      <div>
        <SubmitButton
          pending={pending}
          idle="Save Public Trust Content"
          busy="Saving…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}

/** NTF-01 (Part 5 §1): set/override a docType's expiry-reminder threshold ladder ("configurable by document type"). */
export function SetDocumentExpiryPolicyForm() {
  const [state, formAction, pending] = useActionState(setDocumentExpiryPolicyAction, INITIAL);
  return (
    <form action={formAction} className="field-list form-narrow">
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="expiry-docType">
            Document Type
          </label>
          <input
            id="expiry-docType"
            name="docType"
            type="text"
            required
            className="input"
            list="catalogue-document-types"
            placeholder="e.g. Bank Statement"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="expiry-thresholdDays">
            Reminder Thresholds (Days, Comma-Separated)
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
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Save Thresholds"
          busy="Saving…"
          className="btn btn-secondary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
