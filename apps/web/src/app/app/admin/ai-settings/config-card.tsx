import type { AiProviderConfig, AiProviderDataTerms } from '@visastack/services';
import { unitsToUsd } from '../../../../lib/ai';
import { reasoningEffortLabel } from '../../../../lib/ai-models';
import { formatTimestamp } from '../../../../lib/format-date';
import { aiProviderLabel } from '../../../../lib/labels';
import { TermsRows } from './data-terms';
import {
  ActivateConfigButton,
  type ConfigFormView,
  DeleteDraftButton,
  EditConfigForm,
  type FallbackOption,
  RecordTermsForm,
  RevokeKeyButton,
  RunEvaluationButton,
  TestConnectionButton,
} from './forms';

const STATUS_BADGE: Record<AiProviderConfig['status'], { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'badge-neutral' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUPERSEDED: { label: 'Superseded', tone: 'badge-neutral' },
  DISABLED: { label: 'Disabled', tone: 'badge-danger' },
};

function usd(units: number): string {
  return `$${unitsToUsd(units).toFixed(2)}`;
}

/** One fact of a configuration: its label right above its value. */
function Fact({
  label,
  children,
  wide = false,
  code = false,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly wide?: boolean;
  /** A machine value (a key ending, an ID) shown in the code font. */
  readonly code?: boolean;
}) {
  return (
    <div className={wide ? 'row row-wide' : 'row'}>
      <span className="row-key">{label}</span>
      <span className={code ? 'row-val mono' : 'row-val'}>{children}</span>
    </div>
  );
}

/**
 * One saved AI configuration: who and what it runs (provider and model), its status, its facts in
 * a grid that reads label-then-value, one bar of actions (the safe ones first, revoke and delete
 * at the far end), and the edit and data terms forms folded away until asked for.
 */
export function ConfigCard({
  config,
  formView,
  fallbackTarget,
  terms,
  fallbackOptions,
}: {
  readonly config: AiProviderConfig;
  readonly formView: ConfigFormView;
  /** The configuration this one falls back to, when fallback is on and the target still exists. */
  readonly fallbackTarget: AiProviderConfig | undefined;
  readonly terms: AiProviderDataTerms;
  readonly fallbackOptions: readonly FallbackOption[];
}) {
  const badge = STATUS_BADGE[config.status];
  const isDraft = config.status === 'DRAFT';
  const keyLive = config.keyRevokedAt === null;
  const canActivate = isDraft && config.dataPolicyApproved && keyLive;
  const configName = `${aiProviderLabel(config.provider)} ${config.model}`;
  const kickerId = `config-${config.id}-provider`;
  const titleId = `config-${config.id}-title`;
  const statusId = `config-${config.id}-status`;

  return (
    // Named by provider, model and status together, so two versions of one model differ.
    <article className="card" aria-labelledby={`${kickerId} ${titleId} ${statusId}`}>
      <div className="card-head">
        <div>
          <p className="card-kicker" id={kickerId}>
            {aiProviderLabel(config.provider)}
          </p>
          <h4 className="card-title mono" id={titleId}>
            {config.model}
          </h4>
        </div>
        <span className={`badge ${badge.tone}`} id={statusId}>
          {badge.label}
        </span>
      </div>

      <div className="rows rows-grid">
        <Fact label="API Key" code>
          {config.apiKeyFingerprint}
        </Fact>
        <Fact label="Data Policy">
          <span
            className={`badge ${config.dataPolicyApproved ? 'badge-success' : 'badge-neutral'}`}
          >
            {config.dataPolicyApproved ? 'Approved' : 'Not Approved'}
          </span>
        </Fact>
        <Fact label="Monthly Budget">{usd(config.budgetLimitUnits)}</Fact>
        <Fact label="Reasoning Effort">{reasoningEffortLabel(config.reasoningEffort)}</Fact>
        <Fact label="Fallback">
          {!config.fallbackEnabled
            ? 'Off'
            : fallbackTarget
              ? `${aiProviderLabel(fallbackTarget.provider)}, ${fallbackTarget.model}`
              : 'Configured target no longer exists'}
        </Fact>
        {config.perDocumentBudgetLimitUnits !== null ? (
          <Fact label="Per-Document Budget">{usd(config.perDocumentBudgetLimitUnits)}</Fact>
        ) : null}
        {config.maxAttemptsPerDocument !== null ? (
          <Fact label="Max Attempts per Document">{config.maxAttemptsPerDocument}</Fact>
        ) : null}
        {config.maxPagesPerDocument !== null ? (
          <Fact label="Max Pages per Document">{config.maxPagesPerDocument}</Fact>
        ) : null}
        {config.cacheMaxAgeDays !== null ? (
          <Fact label="Readings Kept For">{config.cacheMaxAgeDays} days</Fact>
        ) : null}
        {config.maxConcurrentCalls !== null ? (
          <Fact label="Max Calls at Once">{config.maxConcurrentCalls}</Fact>
        ) : null}
        <TermsRows terms={terms} />
        {config.keyRevokedAt !== null ? (
          <Fact label="Key Revoked">{formatTimestamp(config.keyRevokedAt)}</Fact>
        ) : null}
        <Fact label="Created">{formatTimestamp(config.createdAt)}</Fact>
        {config.notes !== null && config.notes.length > 0 ? (
          <Fact label="Notes" wide>
            {config.notes}
          </Fact>
        ) : null}
      </div>

      {keyLive || isDraft ? (
        <div className="action-bar">
          {keyLive ? <TestConnectionButton configId={config.id} configName={configName} /> : null}
          {keyLive ? <RunEvaluationButton configId={config.id} configName={configName} /> : null}
          {canActivate ? (
            <ActivateConfigButton configId={config.id} configName={configName} />
          ) : null}
          <div className="action-bar-end">
            {keyLive ? <RevokeKeyButton configId={config.id} configName={configName} /> : null}
            {isDraft ? <DeleteDraftButton configId={config.id} configName={configName} /> : null}
          </div>
        </div>
      ) : null}

      <div className="stack-sm u-mt-100">
        <details className="disclosure form-more">
          <summary>
            {formView.editableInPlace ? 'Edit' : 'Edit as New Draft'}
            <span className="sr-only"> {configName}</span>
          </summary>
          <div className="disclosure-body">
            <EditConfigForm config={formView} fallbackOptions={fallbackOptions} />
          </div>
        </details>
        <details className="disclosure form-more">
          <summary>
            Record Data Terms<span className="sr-only"> for {configName}</span>
          </summary>
          <div className="disclosure-body">
            <RecordTermsForm configId={config.id} />
          </div>
        </details>
      </div>
    </article>
  );
}
