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
  CreateDraftConfigForm,
  EmergencyDisableButton,
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

/**
 * AI Providers: configure, activate and roll back the provider that reads documents (Part 8
 * section 5). Every version is a permanent snapshot, never edited in place.
 */
export function AiProvidersSection({ data }: { readonly data: AiProviderSettingsData }) {
  return (
    <section className="u-mt-150" id="ai-providers" aria-labelledby="ai-providers-title">
      <div className="toolbar">
        <h2 className="section-title" id="ai-providers-title">
          AI Providers
        </h2>
        <ProviderActions data={data} />
      </div>
      {!data.hasAny ? (
        <div className="notice u-mb-150">
          No AI provider has been set up here yet. Reading with AI runs on the deployment’s own
          settings, if they turn it on. Saving a draft below and activating it moves this platform
          to the versioned settings on this page; from then on the deployment’s own settings are no
          longer used.
        </div>
      ) : !data.hasActive ? (
        <div className="notice notice-warn u-mb-150">
          <strong>Nothing is currently ACTIVE.</strong> AI extraction is disabled platform-wide
          until a configuration below is activated or rolled back to.
        </div>
      ) : null}

      <article className="card u-mb-150">
        <p className="card-kicker">New Configuration</p>
        <h2 className="card-title">Create Draft</h2>
        <p className="card-body u-mb-100">
          Saving a draft has no effect on live traffic -- it only takes effect once activated below.
          The API key is write-only: it is encrypted immediately and never shown again, only a
          masked fingerprint.
        </p>
        <CreateDraftConfigForm existingConfigs={data.history} />
      </article>

      {data.history.length > 0 ? (
        <div className="field-list">
          {data.history.map((config) => {
            const badge = STATUS_BADGE[config.status];
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
            const fallbackTarget = config.fallbackEnabled
              ? data.history.find((c) => c.id === config.fallbackProviderConfigId)
              : undefined;
            return (
              <article className="card" key={config.id}>
                <div className="toolbar u-mb-100">
                  <h2 className="card-title u-m-0">
                    {config.provider} / {config.model}
                  </h2>
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
                {canTest || canEvaluate || canActivate || canRevoke ? (
                  <div className="page-actions u-mt-100">
                    {canTest ? <TestConnectionButton configId={config.id} /> : null}
                    {canEvaluate ? <RunEvaluationButton configId={config.id} /> : null}
                    {canActivate ? <ActivateConfigButton configId={config.id} /> : null}
                    {canRevoke ? <RevokeKeyButton configId={config.id} /> : null}
                  </div>
                ) : null}
                <details className="u-mt-100">
                  <summary className="muted">Record Data Terms</summary>
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
