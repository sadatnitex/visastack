import {
  type AiProviderConfig,
  aiProviderTermsFor,
  getAiConnectionCounts,
  hasAnyAiProviderConfig,
  listAiProviderConfigHistory,
  loadAiDataRuleSetting,
  loadAiProviderDataTerms,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { unitsToUsd } from '../../../../lib/ai';
import { aiConnectorEnabled } from '../../../../lib/ai-connector';
import { currentAiDataMode } from '../../../../lib/ai-data-rule';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';
import { AiConnectionsCard, type AiConnectionsCardProps } from './ai-connections-card';
import { ConfigCard } from './config-card';
import { DataTermsPanel } from './data-terms';
import {
  type ConfigFormView,
  CreateDraftConfigForm,
  EmergencyDisableButton,
  type FallbackOption,
  RollbackConfigButton,
} from './forms';
import { StickyDetails } from './sticky-details';

export const metadata: Metadata = { title: 'AI Settings' };

export const dynamic = 'force-dynamic';
// The "run task evaluation" action below makes up to 13 sequential real
// provider calls (the full eval harness dataset, one call per case), each
// individually capped at the adapter's own 60s timeout -- a platform
// default execution window (well under a minute on most deployment tiers)
// would not survive a normal run, let alone a slow one. This codebase's
// other genuinely long-running server-side work (the /api/jobs/* sweep
// routes) already uses the same `maxDuration` export for the identical
// reason; if this deployment's plan caps lower than the value below, Vercel
// itself clamps to that ceiling rather than erroring.
export const maxDuration = 300;

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

export default async function AiSettingsPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    // One staff scope is both the access check and the proof the count service asks for.
    const actor = { accountId, email, bootstrapEmails: bootstrapAdminEmails() };
    const staff = await staffPrincipal(db, actor, 'AI_SETTINGS_MANAGE');
    if (!staff.ok) return { authorized: false as const };
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
        const counts = await getAiConnectionCounts(db, staff.value);
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
      authorized: true as const,
      history,
      hasAny,
      hasActive: active !== undefined,
      terms,
      setting,
      mode: currentAiDataMode(),
    };
  });

  if (!data.authorized) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">
            This area is restricted to security admins. If you should have access, ask an existing
            platform owner to grant you the SECURITY_ADMIN role.
          </p>
        </article>
      </section>
    );
  }

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

  const card = (config: AiProviderConfig) => {
    // Part 8 §13: the target need not be ACTIVE (it commonly is not -- the platform's own
    // single-winner invariant means it is necessarily some other status), so this looks it up by
    // id across the FULL history list, not just active/eligible rows.
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
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/admin" className="muted u-fs-085">
          ← Admin
        </Link>
      </div>
      <PageHeader
        eyebrow="Admin · AI Gateway"
        title="AI Provider Settings"
        description="Configure, activate, and roll back the AI extraction provider (master directive Part 8 §5). A draft can be edited or deleted until it is activated. After that, each version stays in the history as it ran; Edit as New Draft copies it."
        actions={
          data.hasAny ? (
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <RollbackConfigButton />
              {data.hasActive ? <EmergencyDisableButton /> : null}
            </div>
          ) : null
        }
      />

      {!data.hasAny ? (
        <div className="notice u-mb-150">
          No AI provider has ever been configured here. AI extraction is currently running on
          whatever <code>AI_ENABLED</code>/<code>OPENAI_API_KEY</code> environment variables are set
          on this deployment, if any. Saving a draft below and activating it switches this platform
          to this versioned, DB-managed configuration -- from that moment on, those environment
          variables are no longer consulted.
        </div>
      ) : !data.hasActive ? (
        <div className="notice notice-warn u-mb-150">
          <strong>Nothing is currently ACTIVE.</strong> AI extraction is disabled platform-wide
          until a configuration below is activated or rolled back to.
        </div>
      ) : null}

      {/* The data rule comes first: when it pauses AI, that is the first thing to know. */}
      <div className="grid">
        <DataTermsPanel
          mode={data.mode}
          setting={data.setting}
          termsAvailable={data.terms.available}
          active={data.active}
          fallback={data.fallback}
          termsFor={(configId) => aiProviderTermsFor(data.terms, configId)}
        />
        <AiConnectionsCard counts={data.connectionCounts} enabled={aiConnectorEnabled()} />
      </div>

      {data.active ? (
        <section aria-labelledby="ai-active-heading">
          <h2 className="section-heading" id="ai-active-heading">
            Active Setup
          </h2>
          {card(data.active)}
        </section>
      ) : null}

      {drafts.length > 0 ? (
        <section aria-labelledby="ai-drafts-heading">
          <h2 className="section-heading" id="ai-drafts-heading">
            Drafts ({drafts.length})
          </h2>
          <div className="stack-sm">{drafts.map(card)}</div>
        </section>
      ) : null}

      <section aria-labelledby="ai-new-heading">
        <h2 className="section-heading" id="ai-new-heading">
          New Setup
        </h2>
        <StickyDetails
          className="disclosure"
          initiallyOpen={!data.hasAny}
          summary={
            <span>
              <strong>Create a New Draft</strong>
              <span className="muted u-fs-085">
                {' '}
                Has no effect until activated. The API key is encrypted at once and never shown
                again, only its last characters.
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
          <h2 className="section-heading" id="ai-earlier-heading">
            Earlier Versions
          </h2>
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
