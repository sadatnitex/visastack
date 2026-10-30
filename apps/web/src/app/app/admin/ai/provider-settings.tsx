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
import { reportServerError } from '../../../../lib/server-error';
import { AiConnectionsCard, type AiConnectionsCardProps } from '../ai-settings/ai-connections-card';
import { ConfigCard } from '../ai-settings/config-card';
import { DataTermsPanel } from '../ai-settings/data-terms';
import {
  type ConfigFormView,
  CreateDraftConfigForm,
  EmergencyDisableButton,
  type FallbackOption,
  RollbackConfigButton,
} from '../ai-settings/forms';
import { StickyDetails } from '../ai-settings/sticky-details';

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
  const fallbackOptions: FallbackOption[] = data.history.map(({ id, status, provider, model }) => ({
    id,
    status,
    provider,
    model,
  }));
  return { fallbackFor, fallbackOptions };
}

/**
 * AI Providers: configure, activate and roll back the provider that reads documents (Part 8
 * section 5). A draft can be edited or deleted until it is activated; after that each version
 * stays in the history as it ran, and Edit as New Draft copies it (#348).
 */
export function AiProvidersSection({ data }: { readonly data: AiProviderSettingsData }) {
  const { fallbackFor, fallbackOptions } = providerForms(data);
  // One card per version (#351): its facts, its actions and its data terms.
  const card = (config: AiProviderConfig) => {
    // Part 8 section 13: the fallback target need not be ACTIVE, so it is looked up by id across
    // the whole history.
    const fallbackTarget = config.fallbackEnabled
      ? data.history.find((c) => c.id === config.fallbackProviderConfigId)
      : undefined;
    return (
      <ConfigCard
        key={config.id}
        config={config}
        formView={toConfigFormView(config, fallbackFor)}
        fallbackTarget={fallbackTarget}
        terms={aiProviderTermsFor(data.terms, config.id)}
        fallbackOptions={fallbackOptions}
      />
    );
  };
  const drafts = data.history.filter((c) => c.status === 'DRAFT');
  const earlier = data.history.filter((c) => c.status === 'SUPERSEDED' || c.status === 'DISABLED');
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

      {data.active ? (
        <section aria-labelledby="ai-active-heading">
          <h3 className="section-heading" id="ai-active-heading">
            Active Setup
          </h3>
          {card(data.active)}
        </section>
      ) : null}

      {drafts.length > 0 ? (
        <section aria-labelledby="ai-drafts-heading">
          <h3 className="section-heading" id="ai-drafts-heading">
            Drafts ({drafts.length})
          </h3>
          <div className="stack-sm">{drafts.map(card)}</div>
        </section>
      ) : null}

      <section aria-labelledby="ai-new-heading">
        <h3 className="section-heading" id="ai-new-heading">
          New Setup
        </h3>
        <StickyDetails
          className="disclosure"
          initiallyOpen={!data.hasAny}
          summary={
            <span>
              <strong>Create a New Draft</strong>
              <span className="muted u-fs-085">
                {' '}
                Saving a draft changes nothing for anyone until you activate it. The API key is
                locked away as soon as you save it and never shown again, only its last few
                characters.
              </span>
            </span>
          }
        >
          <div className="disclosure-body">
            <CreateDraftConfigForm fallbackOptions={fallbackOptions} />
          </div>
        </StickyDetails>
      </section>

      {earlier.length > 0 ? (
        <section aria-labelledby="ai-earlier-heading">
          <h3 className="section-heading" id="ai-earlier-heading">
            Earlier Versions
          </h3>
          <details className="disclosure">
            <summary>
              Show {earlier.length} earlier {earlier.length === 1 ? 'version' : 'versions'}
            </summary>
            <div className="disclosure-body stack-sm">{earlier.map(card)}</div>
          </details>
        </section>
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
