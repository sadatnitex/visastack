'use client';

import type { AiProviderConfig } from '@visastack/services';
import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { aiConfigStatusLabel, aiProviderLabel } from '../../../../lib/labels';
import {
  type ActionState,
  activateAiProviderConfigAction,
  createDraftAiProviderConfigAction,
  deleteDraftAiProviderConfigAction,
  emergencyDisableAiProviderConfigAction,
  recordAiProviderTermsAction,
  revokeAiProviderConfigKeyAction,
  rollbackAiProviderConfigAction,
  runAiProviderConfigEvaluationAction,
  setAiDataRuleAction,
  testAiProviderConfigAction,
  updateDraftAiProviderConfigAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

function StatusMessage({ state }: { readonly state: ActionState }) {
  return <FormMessage result={state} />;
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
  { value: '', label: 'Use Model Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

/** What a settings form may know about one saved configuration: never its key material. */
export interface ConfigFormView {
  readonly id: string;
  readonly status: AiProviderConfig['status'];
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly dataPolicyApproved: boolean;
  readonly budgetUsd: number;
  readonly perDocumentBudgetUsd: number | null;
  readonly maxAttemptsPerDocument: number | null;
  readonly maxPagesPerDocument: number | null;
  readonly cacheMaxAgeDays: number | null;
  readonly maxConcurrentCalls: number | null;
  readonly fallbackEnabled: boolean;
  readonly fallbackProviderConfigId: string | null;
  readonly notes: string | null;
  readonly apiKeyFingerprint: string;
  readonly keyRevoked: boolean;
  /**
   * False for anything but a draft that may still change: an activated version, a draft whose
   * key was revoked, or a draft another version that has run falls back to. Those are copied
   * into a new draft instead.
   */
  readonly editableInPlace: boolean;
}

/** One entry of the fallback list: only what the option shows. */
export interface FallbackOption {
  readonly id: string;
  readonly status: AiProviderConfig['status'];
  readonly provider: string;
  readonly model: string;
}

/** How the key field behaves: a new draft needs one; an edit or a copy may keep the saved one. */
type KeyMode = 'required' | 'keep' | 'copy';

const KEY_PLACEHOLDER: Record<KeyMode, string> = {
  required: 'Write-only -- never shown again after saving',
  keep: 'Leave blank to keep the saved key',
  copy: 'Leave blank to reuse the saved key',
};

/**
 * Every setting of a configuration except the provider, shared by the create, edit and "edit as
 * new draft" forms. `config` prefills the fields; `idPrefix` keeps ids unique when several forms
 * are on the page.
 *
 * `fallbackOptions` populates the fallback dropdown (Part 8 §13) -- every
 * configuration ever created, any status, since a fallback target need not
 * be ACTIVE (it commonly is not: the platform's own single-winner ACTIVE
 * invariant means a fallback target is necessarily some other status, most
 * naturally the config this new one might one day supersede). The real
 * eligibility gate (different provider, data policy approved, key not
 * revoked) is enforced server-side at activation time
 * (`activateAiProviderConfig`), not here -- a DRAFT is inert either way, the
 * same "loose at save time, hard-gated at activation" discipline every
 * other field on this form already follows.
 */
function ConfigSettingsFields({
  idPrefix,
  fallbackOptions,
  config,
  keyMode,
}: {
  readonly idPrefix: string;
  readonly fallbackOptions: readonly FallbackOption[];
  readonly config?: ConfigFormView;
  readonly keyMode: KeyMode;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const usd = (value: number | null | undefined) =>
    value === null || value === undefined ? undefined : Number(value.toFixed(2));
  return (
    <>
      <div className="field-row">
        <label className="field-label" htmlFor={id('model')}>
          Model
        </label>
        <input
          id={id('model')}
          name="model"
          type="text"
          required
          className="input"
          placeholder="e.g. gpt-5 or claude-opus-5-5"
          defaultValue={config?.model}
          aria-describedby={id('model-hint')}
        />
        <p id={id('model-hint')} className="field-hint">
          The exact model ID from the provider, such as claude-opus-5-5, not its display name.
        </p>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('reasoningEffort')}>
          Reasoning Effort
        </label>
        <select
          id={id('reasoningEffort')}
          name="reasoningEffort"
          className="input"
          defaultValue={config?.reasoningEffort ?? ''}
          aria-describedby={id('reasoningEffort-hint')}
        >
          {REASONING_EFFORT_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <p id={id('reasoningEffort-hint')} className="field-hint">
          Lower is faster and cheaper; higher reads more carefully. Keep Use Model Default unless
          the model supports this setting. Claude models that do not support it skip it.
        </p>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('apiKey')}>
          API Key
        </label>
        <input
          id={id('apiKey')}
          name="apiKey"
          type="password"
          required={keyMode === 'required'}
          autoComplete="off"
          className="input"
          placeholder={KEY_PLACEHOLDER[keyMode]}
          aria-describedby={config ? id('apiKey-hint') : undefined}
        />
        {config ? (
          <p id={id('apiKey-hint')} className="field-hint">
            Saved key: {config.apiKeyFingerprint}.
            {keyMode === 'keep'
              ? ' A new key clears the data terms recorded for this draft; record them again for the new key.'
              : ''}
          </p>
        ) : null}
      </div>
      <label className="check">
        <input
          type="checkbox"
          name="dataPolicyApproved"
          defaultChecked={config?.dataPolicyApproved ?? false}
        />
        <span>
          I have reviewed and approved this provider&rsquo;s data handling for this configuration
          (Part 8 §5 reviewed data policy -- required before this configuration can be activated).
        </span>
      </label>
      <div className="field-row">
        <label className="field-label" htmlFor={id('budgetLimitUsd')}>
          Monthly Budget (USD)
        </label>
        <input
          id={id('budgetLimitUsd')}
          name="budgetLimitUsd"
          type="number"
          min="0.01"
          step="0.01"
          required
          className="input"
          placeholder="e.g. 20"
          defaultValue={usd(config?.budgetUsd)}
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('perDocumentBudgetLimitUsd')}>
          Per-Document Budget (USD, Optional)
        </label>
        <input
          id={id('perDocumentBudgetLimitUsd')}
          name="perDocumentBudgetLimitUsd"
          type="number"
          min="0.01"
          step="0.01"
          className="input"
          placeholder="e.g. 0.5"
          defaultValue={usd(config?.perDocumentBudgetUsd)}
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('maxAttemptsPerDocument')}>
          Max Attempts per Document (Optional)
        </label>
        <input
          id={id('maxAttemptsPerDocument')}
          name="maxAttemptsPerDocument"
          type="number"
          min="1"
          step="1"
          className="input"
          placeholder="e.g. 3"
          defaultValue={config?.maxAttemptsPerDocument ?? undefined}
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('maxPagesPerDocument')}>
          Max Pages per Document (Optional)
        </label>
        <input
          id={id('maxPagesPerDocument')}
          name="maxPagesPerDocument"
          type="number"
          min="1"
          step="1"
          className="input"
          placeholder="e.g. 25"
          defaultValue={config?.maxPagesPerDocument ?? undefined}
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('cacheMaxAgeDays')}>
          Cache Max Age, Days (Optional)
        </label>
        <input
          id={id('cacheMaxAgeDays')}
          name="cacheMaxAgeDays"
          type="number"
          min="1"
          step="1"
          className="input"
          placeholder="e.g. 30"
          defaultValue={config?.cacheMaxAgeDays ?? undefined}
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('maxConcurrentCalls')}>
          Max Concurrent Calls (Optional)
        </label>
        <input
          id={id('maxConcurrentCalls')}
          name="maxConcurrentCalls"
          type="number"
          min="1"
          step="1"
          className="input"
          placeholder="e.g. 5"
          defaultValue={config?.maxConcurrentCalls ?? undefined}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          name="fallbackEnabled"
          defaultChecked={config?.fallbackEnabled ?? false}
        />
        <span>
          Enable cross-provider fallback (Part 8 §13): if this configuration&rsquo;s call times out
          or is rate-limited, automatically retry once against the fallback configuration below.
          Never used after a refusal, an authentication failure, or any other non-recoverable
          outcome. The fallback must use a different provider.
        </span>
      </label>
      <div className="field-row">
        <label className="field-label" htmlFor={id('fallbackProviderConfigId')}>
          Fallback Configuration (Optional)
        </label>
        <select
          id={id('fallbackProviderConfigId')}
          name="fallbackProviderConfigId"
          className="input"
          defaultValue={config?.fallbackProviderConfigId ?? ''}
        >
          <option value="">None</option>
          {fallbackOptions
            .filter((c) => c.id !== config?.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {aiProviderLabel(c.provider)}, {c.model}: {aiConfigStatusLabel(c.status)}
              </option>
            ))}
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('notes')}>
          Notes (Optional)
        </label>
        <input
          id={id('notes')}
          name="notes"
          type="text"
          className="input"
          placeholder="Internal notes"
          defaultValue={config?.notes ?? undefined}
        />
      </div>
    </>
  );
}

/** Save a new DRAFT configuration. Has no effect on live traffic until activated. */
export function CreateDraftConfigForm({
  fallbackOptions,
}: {
  readonly fallbackOptions: readonly FallbackOption[];
}) {
  const [state, formAction, pending] = useActionState(createDraftAiProviderConfigAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <div className="field-row">
        <label className="field-label" htmlFor="draft-provider">
          Provider
        </label>
        <select
          id="draft-provider"
          name="provider"
          required
          className="input"
          defaultValue="openai"
        >
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <ConfigSettingsFields idPrefix="draft" fallbackOptions={fallbackOptions} keyMode="required" />
      <TermsFields idPrefix="draft" optional />
      <div>
        <SubmitButton
          pending={pending}
          idle="Save Draft"
          busy="Saving…"
          className="btn btn-primary"
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

/**
 * Edit one saved configuration. A DRAFT has never run, so it is changed in place. Any other
 * status is part of the record of what the platform ran under, so its settings are copied into a
 * new draft instead, reusing its saved key unless a new one is entered (a revoked key is never
 * reused). The provider is fixed here: the key and data terms belong to that provider's account.
 */
export function EditConfigForm({
  config,
  fallbackOptions,
}: {
  readonly config: ConfigFormView;
  readonly fallbackOptions: readonly FallbackOption[];
}) {
  const inPlace = config.editableInPlace;
  const [state, formAction, pending] = useActionState(
    inPlace ? updateDraftAiProviderConfigAction : createDraftAiProviderConfigAction,
    INITIAL,
  );
  const keyMode: KeyMode = inPlace ? 'keep' : config.keyRevoked ? 'required' : 'copy';
  return (
    <form action={formAction} className="field-list u-mt-100">
      {inPlace ? (
        <input type="hidden" name="configId" value={config.id} />
      ) : (
        <>
          <input type="hidden" name="provider" value={config.provider} />
          {config.keyRevoked ? null : (
            <input type="hidden" name="copyApiKeyFromConfigId" value={config.id} />
          )}
          <p className="card-body">
            This version stays as it is. Saving creates a new draft with these settings, which you
            can test and activate.
          </p>
        </>
      )}
      <div className="row">
        <span className="row-key">Provider</span>
        <span className="row-val">{aiProviderLabel(config.provider)}</span>
      </div>
      <ConfigSettingsFields
        idPrefix={`edit-${config.id}`}
        fallbackOptions={fallbackOptions}
        config={config}
        keyMode={keyMode}
      />
      <div>
        <SubmitButton
          pending={pending}
          idle={inPlace ? 'Save Changes' : 'Save as New Draft'}
          busy="Saving…"
          className="btn btn-primary u-btn-sm"
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

/** Delete a DRAFT with its key and data terms; nothing else can be deleted, only revoked. */
export function DeleteDraftButton({
  configId,
  configName,
}: {
  readonly configId: string;
  /** Names the configuration in the button's accessible name, since every card has one. */
  readonly configName?: string;
}) {
  const [state, formAction, pending] = useActionState(deleteDraftAiProviderConfigAction, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Delete this draft? Its saved key and data terms are removed. This cannot be undone.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="configId" value={configId} />
      <SubmitButton
        pending={pending}
        idle="Delete Draft"
        {...(configName ? { label: `Delete Draft for ${configName}` } : {})}
        busy="Deleting…"
        className="btn btn-danger u-btn-sm"
      />
      <StatusMessage state={state} />
    </form>
  );
}

/**
 * Synthetic connection test (Part 8 §5 / J15's own admin journey: "config
 * OpenAI; test; activate") -- fires a real, minimal call against this
 * configuration's own credentials using fixed synthetic content, never a
 * customer document. Safe on a DRAFT (the whole point: prove a key/model pair
 * works before it can ever touch live traffic) or any other status, so unlike
 * activate/rollback/disable/revoke this needs no confirmation dialog -- it
 * changes no configuration state.
 */
export function TestConnectionButton({
  configId,
  configName,
}: {
  readonly configId: string;
  /** Names the configuration in the button's accessible name, since every card has one. */
  readonly configName?: string;
}) {
  const [state, formAction, pending] = useActionState(testAiProviderConfigAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="configId" value={configId} />
      <SubmitButton
        pending={pending}
        idle="Test Connection"
        {...(configName ? { label: `Test Connection for ${configName}` } : {})}
        busy="Testing…"
        className="btn btn-secondary u-btn-sm"
      />
      <StatusMessage state={state} />
    </form>
  );
}

/**
 * Task evaluation (Part 8 §5 / J15's own admin journey: "config OpenAI; test;
 * activate" -- this is the journey's OTHER named step, "run task
 * evaluation," heavier than the connection test above since it runs the full
 * 13-case eval harness dataset against this configuration's own credentials,
 * never a customer document. Same "no confirmation dialog" reasoning as
 * `TestConnectionButton` -- it changes no configuration state -- but the
 * label names the case count up front, since this makes many more real
 * provider calls than a connection test's single one.
 */
export function RunEvaluationButton({
  configId,
  configName,
}: {
  readonly configId: string;
  /** Names the configuration in the button's accessible name, since every card has one. */
  readonly configName?: string;
}) {
  const [state, formAction, pending] = useActionState(runAiProviderConfigEvaluationAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="configId" value={configId} />
      <SubmitButton
        pending={pending}
        idle="Run Evaluation (13 Cases)"
        {...(configName ? { label: `Run Evaluation (13 Cases) for ${configName}` } : {})}
        busy="Evaluating…"
        className="btn btn-secondary u-btn-sm"
      />
      <StatusMessage state={state} />
    </form>
  );
}

export function ActivateConfigButton({
  configId,
  configName,
}: {
  readonly configId: string;
  /** Names the configuration in the button's accessible name, since every card has one. */
  readonly configName?: string;
}) {
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
      <SubmitButton
        pending={pending}
        idle="Activate"
        {...(configName ? { label: `Activate for ${configName}` } : {})}
        busy="Activating…"
        className="btn btn-primary u-btn-sm"
      />
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
      <SubmitButton
        pending={pending}
        idle="Roll Back"
        busy="Rolling back…"
        className="btn btn-secondary"
      />
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
      <SubmitButton
        pending={pending}
        idle="Emergency Disable"
        busy="Disabling…"
        className="btn btn-danger"
      />
      <StatusMessage state={state} />
    </form>
  );
}

export function RevokeKeyButton({
  configId,
  configName,
}: {
  readonly configId: string;
  /** Names the configuration in the button's accessible name, since every card has one. */
  readonly configName?: string;
}) {
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
      <SubmitButton
        pending={pending}
        idle="Revoke Key"
        {...(configName ? { label: `Revoke Key for ${configName}` } : {})}
        busy="Revoking…"
        className="btn btn-danger u-btn-sm"
      />
      <StatusMessage state={state} />
    </form>
  );
}

/**
 * What the provider's own terms say about the account behind this
 * configuration (owner decision 2026-10-25). On the draft form the whole
 * group is optional (leave the plan as "Not Recorded Yet" to skip it); on
 * the record form every answer is required except retention, region and
 * notes. A "does not train" answer needs the address of the terms, which the
 * server also checks.
 */
function TermsFields({
  idPrefix,
  optional = false,
}: {
  readonly idPrefix: string;
  readonly optional?: boolean;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <fieldset className="field-list">
      <legend className="field-label">Provider Data Terms</legend>
      <div className="field-row">
        <label className="field-label" htmlFor={id('termsTier')}>
          Plan
        </label>
        <select
          id={id('termsTier')}
          name="termsTier"
          className="input"
          defaultValue=""
          required={!optional}
        >
          <option value="">{optional ? 'Not Recorded Yet' : 'Choose'}</option>
          <option value="FREE">Free</option>
          <option value="PAID">Paid</option>
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('termsTrains')}>
          May Train on What It Is Sent
        </label>
        <select id={id('termsTrains')} name="termsTrains" className="input" defaultValue="UNKNOWN">
          <option value="UNKNOWN">Not Known</option>
          <option value="YES">Yes</option>
          <option value="NO">No</option>
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('termsRetentionDays')}>
          Kept for How Many Days (Optional)
        </label>
        <input
          id={id('termsRetentionDays')}
          name="termsRetentionDays"
          type="number"
          min="0"
          max="3650"
          step="1"
          className="input"
          placeholder="e.g. 30"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('termsRegion')}>
          Where It Is Processed (Optional)
        </label>
        <input
          id={id('termsRegion')}
          name="termsRegion"
          type="text"
          maxLength={120}
          className="input"
          placeholder="e.g. United States"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('termsUrl')}>
          Terms Address
        </label>
        <input
          id={id('termsUrl')}
          name="termsUrl"
          type="url"
          maxLength={500}
          className="input"
          placeholder="https://"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('termsCheckedOn')}>
          Date Checked
        </label>
        <input
          id={id('termsCheckedOn')}
          name="termsCheckedOn"
          type="date"
          className="input"
          required={!optional}
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={id('termsNotes')}>
          What the Terms Say (Optional)
        </label>
        <input
          id={id('termsNotes')}
          name="termsNotes"
          type="text"
          maxLength={500}
          className="input"
          placeholder="Short note, e.g. section name"
        />
      </div>
    </fieldset>
  );
}

/** Record a fresh reading of the provider's terms for one configuration. Saved as a new entry; earlier entries stay in the history. */
export function RecordTermsForm({ configId }: { readonly configId: string }) {
  const [state, formAction, pending] = useActionState(recordAiProviderTermsAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="configId" value={configId} />
      <TermsFields idPrefix={`terms-${configId}`} />
      <div>
        <SubmitButton
          pending={pending}
          idle="Save Data Terms"
          busy="Saving…"
          className="btn btn-secondary u-btn-sm"
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}

/**
 * The platform switch "Only Use AI Providers That Do Not Train on Inputs"
 * (owner decision 2026-10-25: off by default). Changing it asks for a fresh
 * sign-in check and is written to the audit history.
 */
export function DataRuleForm({ requireNoTraining }: { readonly requireNoTraining: boolean }) {
  const [state, formAction, pending] = useActionState(setAiDataRuleAction, INITIAL);
  return (
    <form
      action={formAction}
      className="field-list"
      onSubmit={(e) => {
        const message = requireNoTraining
          ? 'Turn this off? AI will run on every active provider again, including ones that may train on what they are sent.'
          : 'Turn this on? AI stops at once for any provider not recorded as leaving inputs alone. People can still fill in everything themselves.';
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      <input type="hidden" name="requireNoTraining" value={requireNoTraining ? 'off' : 'on'} />
      <div className="field-row">
        <label className="field-label" htmlFor="dataRuleReason">
          Reason (Optional)
        </label>
        <input
          id="dataRuleReason"
          name="reason"
          type="text"
          maxLength={500}
          className="input"
          placeholder="e.g. Real applicants invited"
        />
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle={requireNoTraining ? 'Turn Off' : 'Turn On'}
          busy="Saving…"
          className={requireNoTraining ? 'btn btn-secondary' : 'btn btn-primary'}
        />
        <StatusMessage state={state} />
      </div>
    </form>
  );
}
