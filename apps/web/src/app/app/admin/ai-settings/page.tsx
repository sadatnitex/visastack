import {
  type AiProviderConfig,
  hasAnyAiProviderConfig,
  listAiProviderConfigHistory,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, hasPlatformPermission } from '../../../../lib/admin';
import { unitsToUsd } from '../../../../lib/ai';
import { formatTimestamp } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import {
  ActivateConfigButton,
  CreateDraftConfigForm,
  EmergencyDisableButton,
  RevokeKeyButton,
  RollbackConfigButton,
  RunEvaluationButton,
  TestConnectionButton,
} from './forms';

export const metadata: Metadata = { title: 'AI settings' };

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

const STATUS_BADGE: Record<AiProviderConfig['status'], { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'badge-neutral' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUPERSEDED: { label: 'Superseded', tone: 'badge-neutral' },
  DISABLED: { label: 'Disabled', tone: 'badge-danger' },
};

export default async function AiSettingsPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return { authorized: false as const };
    }
    const historyResult = await listAiProviderConfigHistory(db, {
      accountId,
      email,
      bootstrapEmails: bootstrapAdminEmails(),
    });
    const history = historyResult.ok ? historyResult.value : [];
    return {
      authorized: true as const,
      history,
      hasAny: await hasAnyAiProviderConfig(db),
      hasActive: history.some((config) => config.status === 'ACTIVE'),
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

  return (
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/admin" className="muted u-fs-090">
          ← Admin
        </Link>
      </div>
      <PageHeader
        eyebrow="Admin · AI Gateway"
        title="AI provider settings"
        description="Configure, activate, and roll back the AI extraction provider (master directive Part 8 §5). Every version below is a permanent, immutable snapshot -- nothing is ever edited in place."
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

      <article className="card u-mb-150">
        <p className="card-kicker">New configuration</p>
        <h2 className="card-title">Create draft</h2>
        <p className="card-body u-mb-100">
          Saving a draft has no effect on live traffic -- it only takes effect once activated below.
          The API key is write-only: it is encrypted immediately and never shown again, only a
          masked fingerprint.
        </p>
        <CreateDraftConfigForm existingConfigs={data.history} />
      </article>

      {data.history.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
                <div className="toolbar" style={{ marginBottom: '1rem', alignItems: 'center' }}>
                  <h2 className="card-title u-m-0">
                    {config.provider} / {config.model}
                  </h2>
                  <span className={`badge ${badge.tone}`}>{badge.label}</span>
                </div>
                <div className="rows">
                  <div className="row">
                    <span className="row-key">API key</span>
                    <span className="row-val">{config.apiKeyFingerprint}</span>
                  </div>
                  {config.reasoningEffort !== null ? (
                    <div className="row">
                      <span className="row-key">Reasoning effort</span>
                      <span className="row-val">{config.reasoningEffort}</span>
                    </div>
                  ) : null}
                  <div className="row">
                    <span className="row-key">Data policy</span>
                    <span
                      className={`badge ${config.dataPolicyApproved ? 'badge-success' : 'badge-neutral'}`}
                    >
                      {config.dataPolicyApproved ? 'Approved' : 'Not approved'}
                    </span>
                  </div>
                  <div className="row">
                    <span className="row-key">Monthly budget</span>
                    <span className="row-val">
                      ${unitsToUsd(config.budgetLimitUnits).toFixed(2)}
                    </span>
                  </div>
                  {config.perDocumentBudgetLimitUnits !== null ? (
                    <div className="row">
                      <span className="row-key">Per-document budget</span>
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
                      <span className="row-key">Cache max age</span>
                      <span className="row-val">{config.cacheMaxAgeDays} days</span>
                    </div>
                  ) : null}
                  {config.maxConcurrentCalls !== null ? (
                    <div className="row">
                      <span className="row-key">Max concurrent calls</span>
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
                      <span className="row-key">Key revoked</span>
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
                  <div className="row">
                    <span className="row-key">Created</span>
                    <span className="muted u-fs-080">{formatTimestamp(config.createdAt)}</span>
                  </div>
                </div>
                {canTest || canEvaluate || canActivate || canRevoke ? (
                  <div
                    style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}
                  >
                    {canTest ? <TestConnectionButton configId={config.id} /> : null}
                    {canEvaluate ? <RunEvaluationButton configId={config.id} /> : null}
                    {canActivate ? <ActivateConfigButton configId={config.id} /> : null}
                    {canRevoke ? <RevokeKeyButton configId={config.id} /> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
