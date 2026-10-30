import {
  type AiProviderConfig,
  type Db,
  type PlatformAuthInput,
  type StaffScope,
  aiProviderTermsFor,
  getAiConnectionCounts,
  hasAnyAiProviderConfig,
  listAiProviderConfigHistory,
  loadAiDataRuleSetting,
  loadAiProviderDataTerms,
} from '@visastack/services';
import { unitsToUsd } from '../../../../lib/ai';
import { aiConnectorEnabled } from '../../../../lib/ai-connector';
import { currentAiDataMode } from '../../../../lib/ai-data-rule';
import { formatTimestamp } from '../../../../lib/format-date';
import { reportServerError } from '../../../../lib/server-error';
import { AiConnectionsCard, type AiConnectionsCardProps } from '../ai-settings/ai-connections-card';
import { DataTermsPanel, TermsRows } from '../ai-settings/data-terms';
import {
  ActivateConfigButton,
  type ConfigFormView,
  CreateDraftConfigForm,
  DeleteDraftButton,
  EditConfigForm,
  EmergencyDisableButton,
  type FallbackOption,
  RecordTermsForm,
  RevokeKeyButton,
  RollbackConfigButton,
  RunEvaluationButton,
  TestConnectionButton,
} from '../ai-settings/forms';

const STATUS_BADGE: Record<AiProviderConfig['status'], { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'badge-neutral' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUPERSEDED: { label: 'Superseded', tone: 'badge-neutral' },
  DISABLED: { label: 'Disabled', tone: 'badge-danger' },
};

export type AiProviderSettingsData = Awaited<ReturnType<typeof loadAiProviderSettings>>;

/**
 * What the settings forms may see of a configuration: its settings, never its key material.
 * `fallbackFor` holds the ids that a version which has run falls back to; those drafts are
 * copied rather than edited (the service refuses the edit too).
 */
function toConfigFormView(
  config: AiProviderConfig,
  fallbackFor: ReadonlySet<string>,
): ConfigFormView {
  return {
    id: config.id,
    status: config.status,
    provider: config.provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    dataPolicyApproved: config.dataPolicyApproved,
    budgetUsd: unitsToUsd(config.budgetLimitUnits),
    perDocumentBudgetUsd:
      config.perDocumentBudgetLimitUnits === null
        ? null
        : unitsToUsd(config.perDocumentBudgetLimitUnits),
    maxAttemptsPerDocument: config.maxAttemptsPerDocument,
    maxPagesPerDocument: config.maxPagesPerDocument,
    cacheMaxAgeDays: config.cacheMaxAgeDays,
    maxConcurrentCalls: config.maxConcurrentCalls,
    fallbackEnabled: config.fallbackEnabled,
    fallbackProviderConfigId: config.fallbackProviderConfigId,
    notes: config.notes,
    apiKeyFingerprint: config.apiKeyFingerprint,
    keyRevoked: config.keyRevokedAt !== null,
    editableInPlace:
      config.status === 'DRAFT' && config.keyRevokedAt === null && !fallbackFor.has(config.id),
  };
}

/**
 * What the AI Providers, Data Terms and AI Apps sections show (merged into the one AI area by S28
 * from the former AI Settings page). The caller has already minted `staff` for this person.
 */
export async function loadAiProviderSettings(
  db: Db,
  actor: PlatformAuthInput,
  staff: StaffScope<'AI_SETTINGS_MANAGE'>,
) {
  // One staff scope is both the access check and the proof the count service asks for.
  const historyAndTerms = async () => {
    const historyResult = await listAiProviderConfigHistory(db, actor);
    const history = historyResult.ok ? historyResult.value : [];
    const terms = await loadAiProviderDataTerms(
      db,
      history.map((config) => config.id),
    );
    return { history, terms };
  };
  // The count card must never take the provider settings down with it: a failed read is
  // logged and the card says the counts cannot be read right now.
  const connectionCounts = async (): Promise<AiConnectionsCardProps['counts']> => {
    try {
      const counts = await getAiConnectionCounts(db, staff);
      return counts.ok ? counts.value : 'unreadable';
    } catch (error) {
      reportServerError('aiConnectionCounts', error);
      return 'unreadable';
    }
  };
  const [{ history, terms }, hasAny, setting, counts] = await Promise.all([
    historyAndTerms(),
    hasAnyAiProviderConfig(db),
    loadAiDataRuleSetting(db),
    connectionCounts(),
  ]);
  const active = history.find((config) => config.status === 'ACTIVE');
  const fallback = active?.fallbackEnabled
    ? history.find((config) => config.id === active.fallbackProviderConfigId)
    : undefined;
  return {
    connectionCounts: counts,
    active,
    fallback,
    history,
    hasAny,
    hasActive: active !== undefined,
    terms,
    setting,
    mode: currentAiDataMode(),
  };
}

/** The rollback and emergency-off buttons, shown in the AI Providers section's heading row. */
function ProviderActions({ data }: { readonly data: AiProviderSettingsData }) {
  if (!data.hasAny) return null;
  return (
    <div className="page-actions">
      <RollbackConfigButton />
      {data.hasActive ? <EmergencyDisableButton /> : null}
    </div>
  );
}

/** The settings each form may see, and the versions a fallback may point at (#348). */
function providerForms(data: AiProviderSettingsData) {
  const fallbackFor = new Set(
    data.history
      .filter((c) => c.status !== 'DRAFT' && c.fallbackEnabled && c.fallbackProviderConfigId)
      .map((c) => c.fallbackProviderConfigId as string),
  );
  const formViews = data.history.map((config) => toConfigFormView(config, fallbackFor));
  const fallbackOptions: FallbackOption[] = data.history.map(({ id, status, provider, model }) => ({
    id,
    status,
    provider,
    model,
  }));
  return { formViews, fallbackOptions };
}

/**
 * AI Providers: configure, activate and roll back the provider that reads documents (Part 8
 * section 5). A draft can be edited or deleted until it is activated; after that each version
 * stays in the history as it ran, and Edit as New Draft copies it (#348).
 */
export function AiProvidersSection({ data }: { readonly data: AiProviderSettingsData }) {
  const { formViews, fallbackOptions } = providerForms(data);
  return (
    <section className="u-mt-150" id="ai-providers" aria-labelledby="ai-providers-title">
      <div className="toolbar">
        <h2 className="section-title" id="ai-providers-title">
          AI Providers
        </h2>
        <ProviderActions data={data} />
      </div>
      <p className="card-body u-mb-100">
        Configure, activate and roll back the AI provider that reads documents. A draft can be
        edited or deleted until it is activated. After that, each version stays in the history as it
        ran; Edit as New Draft copies it.
      </p>
      {!data.hasAny ? (
        <div className="notice u-mb-150">
          No AI provider has been set up here yet. Reading with AI runs on the deployment’s own
          settings, if they turn it on. Saving a draft below and activating it moves this platform
          to the versioned settings on this page; from then on the deployment’s own settings are no
          longer used.
        </div>
      ) : !data.hasActive ? (
        <div className="notice notice-warn u-mb-150">
          <strong>No AI provider is in use right now.</strong> Nothing is read with AI anywhere on
          this platform until you activate a provider below, or go back to an earlier one.
        </div>
      ) : null}

      <article className="card u-mb-150">
        <p className="card-kicker">New Configuration</p>
        <h3 className="card-title">Create Draft</h3>
        <p className="card-body u-mb-100">
          Saving a draft changes nothing for anyone. It is used only once you activate it below. The
          API key is locked away as soon as you save it and is never shown again: this page shows
          only its last few characters, so you can tell keys apart.
        </p>
        <CreateDraftConfigForm fallbackOptions={fallbackOptions} />
      </article>

      {data.history.length > 0 ? (
        <div className="field-list">
          {data.history.map((config, index) => {
            const badge = STATUS_BADGE[config.status];
            const formView = formViews[index];
            const isDraft = config.status === 'DRAFT';
            const canActivate =
              config.status === 'DRAFT' &&
              config.dataPolicyApproved &&
              config.keyRevokedAt === null;
            const canRevoke = config.keyRevokedAt === null;
            // A revoked key is fully retired ("cannot resurrect: revoked
            // key") -- otherwise testing is useful at every other status:
            // before activating a DRAFT, or to re-check an ACTIVE/SUPERSEDED/
            // DISABLED version's credentials still round-trip.
            const canTest = config.keyRevokedAt === null;
            // Same eligibility bar as the connection test -- a revoked key
            // has nothing left to evaluate.
            const canEvaluate = config.keyRevokedAt === null;
            // Part 8 §13: the target need not be ACTIVE (it commonly is not
            // -- the platform's own single-winner invariant means it is
            // necessarily some other status), so this looks it up by id
            // across the FULL history list, not just active/eligible rows.
            const configName = `${config.provider} / ${config.model}`;
            const fallbackTarget = config.fallbackEnabled
              ? data.history.find((c) => c.id === config.fallbackProviderConfigId)
              : undefined;
            return (
              <article className="card" key={config.id}>
                <div className="toolbar u-mb-100">
                  <h3 className="card-title u-m-0">
                    {config.provider} / {config.model}
                  </h3>
                  <span className={`badge ${badge.tone}`}>{badge.label}</span>
                </div>
                <div className="rows">
                  <div className="row">
                    <span className="row-key">API Key</span>
                    <span className="row-val">{config.apiKeyFingerprint}</span>
                  </div>
                  {config.reasoningEffort !== null ? (
                    <div className="row">
                      <span className="row-key">Reasoning Effort</span>
                      <span className="row-val">{config.reasoningEffort}</span>
                    </div>
                  ) : null}
                  <div className="row">
                    <span className="row-key">Data Policy</span>
                    <span
                      className={`badge ${config.dataPolicyApproved ? 'badge-success' : 'badge-neutral'}`}
                    >
                      {config.dataPolicyApproved ? 'Approved' : 'Not Approved'}
                    </span>
                  </div>
                  <div className="row">
                    <span className="row-key">Monthly Budget</span>
                    <span className="row-val">
                      ${unitsToUsd(config.budgetLimitUnits).toFixed(2)}
                    </span>
                  </div>
                  {config.perDocumentBudgetLimitUnits !== null ? (
                    <div className="row">
                      <span className="row-key">Per-Document Budget</span>
                      <span className="row-val">
                        ${unitsToUsd(config.perDocumentBudgetLimitUnits).toFixed(2)}
                      </span>
                    </div>
                  ) : null}
                  {config.maxAttemptsPerDocument !== null ? (
                    <div className="row">
                      <span className="row-key">Max attempts / document</span>
                      <span className="row-val">{config.maxAttemptsPerDocument}</span>
                    </div>
                  ) : null}
                  {config.maxPagesPerDocument !== null ? (
                    <div className="row">
                      <span className="row-key">Max pages / document</span>
                      <span className="row-val">{config.maxPagesPerDocument}</span>
                    </div>
                  ) : null}
                  {config.cacheMaxAgeDays !== null ? (
                    <div className="row">
                      <span className="row-key">Cache Max Age</span>
                      <span className="row-val">{config.cacheMaxAgeDays} days</span>
                    </div>
                  ) : null}
                  {config.maxConcurrentCalls !== null ? (
                    <div className="row">
                      <span className="row-key">Max Concurrent Calls</span>
                      <span className="row-val">{config.maxConcurrentCalls}</span>
                    </div>
                  ) : null}
                  {config.notes !== null && config.notes.length > 0 ? (
                    <div className="row">
                      <span className="row-key">Notes</span>
                      <span className="row-val">{config.notes}</span>
                    </div>
                  ) : null}
                  {config.keyRevokedAt !== null ? (
                    <div className="row">
                      <span className="row-key">Key Revoked</span>
                      <span className="row-val">{formatTimestamp(config.keyRevokedAt)}</span>
                    </div>
                  ) : null}
                  {config.fallbackEnabled ? (
                    <div className="row">
                      <span className="row-key">Fallback</span>
                      <span className="row-val">
                        {fallbackTarget
                          ? `${fallbackTarget.provider} / ${fallbackTarget.model}`
                          : 'Configured target no longer exists'}
                      </span>
                    </div>
                  ) : null}
                  <TermsRows terms={aiProviderTermsFor(data.terms, config.id)} />
                  <div className="row">
                    <span className="row-key">Created</span>
                    <span className="muted u-fs-085">{formatTimestamp(config.createdAt)}</span>
                  </div>
                </div>
                {canTest || canEvaluate || canActivate || canRevoke || isDraft ? (
                  <div className="page-actions u-mt-100">
                    {canTest ? (
                      <TestConnectionButton configId={config.id} configName={configName} />
                    ) : null}
                    {canEvaluate ? (
                      <RunEvaluationButton configId={config.id} configName={configName} />
                    ) : null}
                    {canActivate ? (
                      <ActivateConfigButton configId={config.id} configName={configName} />
                    ) : null}
                    {canRevoke ? (
                      <RevokeKeyButton configId={config.id} configName={configName} />
                    ) : null}
                    {isDraft ? (
                      <DeleteDraftButton configId={config.id} configName={configName} />
                    ) : null}
                  </div>
                ) : null}
                {formView ? (
                  <details className="u-mt-100">
                    <summary className="muted">
                      {formView.editableInPlace ? 'Edit' : 'Edit as New Draft'}
                      <span className="sr-only"> {configName}</span>
                    </summary>
                    <EditConfigForm config={formView} fallbackOptions={fallbackOptions} />
                  </details>
                ) : null}
                <details className="u-mt-100">
                  <summary className="muted">
                    Record Data Terms<span className="sr-only"> for {configName}</span>
                  </summary>
                  <RecordTermsForm configId={config.id} />
                </details>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/** Data Terms: what each provider does with what VisaStack sends. */
export function DataTermsSection({ data }: { readonly data: AiProviderSettingsData }) {
  return (
    <section className="u-mt-150" id="data-terms" aria-labelledby="data-terms-title">
      <h2 className="section-title" id="data-terms-title">
        Data Terms
      </h2>
      <DataTermsPanel
        mode={data.mode}
        setting={data.setting}
        termsAvailable={data.terms.available}
        active={data.active}
        fallback={data.fallback}
        termsFor={(configId) => aiProviderTermsFor(data.terms, configId)}
      />
    </section>
  );
}

/** AI Apps: how many people have AI apps connected, and whether apps can connect at all. */
export function AiAppsSection({ data }: { readonly data: AiProviderSettingsData }) {
  return (
    <section className="u-mt-150" id="ai-apps" aria-labelledby="ai-apps-title">
      <h2 className="section-title" id="ai-apps-title">
        AI Apps
      </h2>
      <AiConnectionsCard counts={data.connectionCounts} enabled={aiConnectorEnabled()} />
    </section>
  );
}
