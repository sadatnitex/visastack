'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  activateAiProviderConfigAction,
  createDraftAiProviderConfigAction,
  emergencyDisableAiProviderConfigAction,
  revokeAiProviderConfigKeyAction,
  rollbackAiProviderConfigAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

function StatusMessage({ state }: { readonly state: ActionState }) {
  if (!state.message) return null;
  return (
    <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>{state.message}</p>
  );
}

// All three directive-named providers (AI-03) are implemented -- a select
// with only real options, rather than free text, avoids a stray typo (e.g.
// "OpenAI") silently saving a draft that can never actually be activated,
// since the gateway's own provider match is case-sensitive.
const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'gemini', label: 'Google Gemini' },
] as const;

const REASONING_EFFORT_OPTIONS = [
  { value: '', label: 'Use model default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

/** Save a new DRAFT configuration. Has no effect on live traffic until activated. */
export function CreateDraftConfigForm() {
  const [state, formAction, pending] = useActionState(createDraftAiProviderConfigAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor="provider">
          Provider
        </label>
        <select id="provider" name="provider" required className="input" defaultValue="openai">
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="model">
          Model
        </label>
        <input
          id="model"
          name="model"
          type="text"
          required
          className="input"
          placeholder="e.g. gpt-5"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="reasoningEffort">
          Reasoning effort
        </label>
        <select id="reasoningEffort" name="reasoningEffort" className="input" defaultValue="">
          {REASONING_EFFORT_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="apiKey">
          API key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          required
          autoComplete="off"
          className="input"
          placeholder="Write-only -- never shown again after saving"
        />
      </div>
      <label className="check">
        <input type="checkbox" name="dataPolicyApproved" />
        <span>
          I have reviewed and approved this provider&rsquo;s data handling for this configuration
          (Part 8 §5 reviewed data policy -- required before this configuration can be activated).
        </span>
      </label>
      <div className="field-row">
        <label className="field-label" htmlFor="budgetLimitUsd">
          Monthly budget (USD)
        </label>
        <input
          id="budgetLimitUsd"
          name="budgetLimitUsd"
          type="number"
          min="0.01"
          step="0.01"
          required
          className="input"
          placeholder="e.g. 20"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="perDocumentBudgetLimitUsd">
          Per-document budget (USD, optional)
        </label>
        <input
          id="perDocumentBudgetLimitUsd"
          name="perDocumentBudgetLimitUsd"
          type="number"
          min="0.01"
          step="0.01"
          className="input"
          placeholder="e.g. 0.5"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="maxAttemptsPerDocument">
          Max attempts per document (optional)
        </label>
        <input
          id="maxAttemptsPerDocument"
          name="maxAttemptsPerDocument"
          type="number"
          min="1"
          step="1"
          className="input"
          placeholder="e.g. 3"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="maxPagesPerDocument">
          Max pages per document (optional)
        </label>
        <input
          id="maxPagesPerDocument"
          name="maxPagesPerDocument"
          type="number"
          min="1"
          step="1"
          className="input"
          placeholder="e.g. 25"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="cacheMaxAgeDays">
          Cache max age, days (optional)
        </label>
        <input
          id="cacheMaxAgeDays"
          name="cacheMaxAgeDays"
          type="number"
          min="1"
          step="1"
          className="input"
          placeholder="e.g. 30"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="maxConcurrentCalls">
          Max concurrent calls (optional)
        </label>
        <input
          id="maxConcurrentCalls"
          name="maxConcurrentCalls"
          type="number"
          min="1"
          step="1"
          className="input"
          placeholder="e.g. 5"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="notes">
          Notes (optional)
        </label>
        <input id="notes" name="notes" type="text" className="input" placeholder="Internal notes" />
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save draft'}
        </button>
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

export function ActivateConfigButton({ configId }: { readonly configId: string }) {
  const [state, formAction, pending] = useActionState(activateAiProviderConfigAction, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Activate this configuration? It immediately replaces whatever is currently ACTIVE.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="configId" value={configId} />
      <button
        type="submit"
        className="btn btn-primary"
        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
        disabled={pending}
      >
        {pending ? 'Activating…' : 'Activate'}
      </button>
      <StatusMessage state={state} />
    </form>
  );
}

export function RollbackConfigButton() {
  const [state, formAction, pending] = useActionState(rollbackAiProviderConfigAction, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Roll back to the last eligible prior configuration? This immediately replaces whatever is currently ACTIVE (or, if nothing is, restores the last one that was).',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button type="submit" className="btn btn-secondary" disabled={pending}>
        {pending ? 'Rolling back…' : 'Roll back'}
      </button>
      <StatusMessage state={state} />
    </form>
  );
}

export function EmergencyDisableButton() {
  const [state, formAction, pending] = useActionState(
    emergencyDisableAiProviderConfigAction,
    INITIAL,
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Emergency-disable AI extraction platform-wide? No replacement is auto-promoted -- extraction stays off until a configuration is activated or rolled back to.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button type="submit" className="btn btn-danger" disabled={pending}>
        {pending ? 'Disabling…' : 'Emergency disable'}
      </button>
      <StatusMessage state={state} />
    </form>
  );
}

export function RevokeKeyButton({ configId }: { readonly configId: string }) {
  const [state, formAction, pending] = useActionState(revokeAiProviderConfigKeyAction, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Revoke this API key? This cannot be undone -- this version can never be activated or rolled back to again.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="configId" value={configId} />
      <button
        type="submit"
        className="btn btn-danger"
        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
        disabled={pending}
      >
        {pending ? 'Revoking…' : 'Revoke key'}
      </button>
      <StatusMessage state={state} />
    </form>
  );
}
