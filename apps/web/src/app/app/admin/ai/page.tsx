import { aiDailyLimitLabel } from '@visastack/core/ai-features';
import { type AiFeatureSettingView, listAiFeatureSettings } from '@visastack/services';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { PageHeader, StatusBadge } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { AI_FEATURE_RETRY_COOKIE, decodeAiFeatureRetry } from '../../../../lib/ai-feature-retry';
import { formatTimestamp } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';
import { AiFeatureForm } from './forms';
import { type AiFeatureValues, PRECEDENCE_NOTE, WHAT_OFF_DOES, limitLine } from './labels';
import {
  AiAppsSection,
  AiProvidersSection,
  DataTermsSection,
  loadAiProviderSettings,
} from './provider-settings';

export const metadata: Metadata = { title: 'AI Settings' };

export const dynamic = 'force-dynamic';
// The provider evaluation action makes up to 13 sequential real provider calls, each capped at the
// adapter's own 60 s timeout; the platform's default window would not survive a normal run. If the
// deployment's plan caps lower, the host clamps to its ceiling rather than failing.
export const maxDuration = 300;

const UNAVAILABLE =
  'AI features cannot be changed yet. Until they can, each AI feature keeps its standard setting, and everything else works as usual.';

function Feature({
  feature,
  retry,
}: {
  readonly feature: AiFeatureSettingView;
  readonly retry: AiFeatureValues | undefined;
}) {
  return (
    <article className="card u-mb-150" aria-labelledby={`ai-feature-${feature.feature}`}>
      <h3 className="card-title" id={`ai-feature-${feature.feature}`}>
        {feature.name}
      </h3>
      <p className="card-body">{feature.description}</p>
      <div className="rows">
        <div className="row">
          <span className="row-key">Now</span>
          <StatusBadge tone={feature.enabled ? 'success' : 'neutral'}>
            {feature.enabled ? 'On' : 'Off'}
          </StatusBadge>
        </div>
        {feature.planIncluded ? null : (
          <div className="row">
            <span className="row-key">Plan</span>
            <span>Not in the Traveller Plan</span>
          </div>
        )}
        <div className="row">
          <span className="row-key">{aiDailyLimitLabel(feature.feature)}</span>
          <span>{limitLine(feature.adminDailyLimit, feature.planDailyLimit)}</span>
        </div>
      </div>
      <p className="muted u-fs-085">
        {feature.updatedAt
          ? `Last changed on ${formatTimestamp(feature.updatedAt)}.`
          : 'Never changed: it uses its standard setting.'}
      </p>
      <h4 className="card-title">Change {feature.name}</h4>
      <AiFeatureForm
        feature={feature.feature}
        name={feature.name}
        enabled={feature.enabled}
        adminDailyLimit={feature.adminDailyLimit}
        planDailyLimit={feature.planDailyLimit}
        {...(retry ? { retry } : {})}
      />
    </article>
  );
}

/**
 * The one AI area (S28): the platform owner turns each AI feature on or off and sets how much
 * each person may use it (AI Features, `AI_FEATURES_MANAGE`), and security admins manage the
 * providers, their data terms and AI apps (`AI_SETTINGS_MANAGE`, formerly AI Settings, which now
 * sends people here). Each section shows only to whoever may use it. Values typed before a fresh
 * sign-in check come back only from the signed cookie the save set for this account, never from
 * the address.
 */
export default async function AiAreaPage() {
  const remembered = (await cookies()).get(AI_FEATURE_RETRY_COOKIE)?.value;
  const data = await withSession(async ({ db, accountId, email }) => {
    const actor = { accountId, email, bootstrapEmails: bootstrapAdminEmails() };
    const readFeatures = async () => {
      const staff = await staffPrincipal(db, actor, 'AI_FEATURES_MANAGE');
      if (!staff.ok) return null;
      const listed = await listAiFeatureSettings(db, staff.value);
      if (!listed.ok) return null;
      if (!listed.value.available) return { kind: 'unavailable' as const };
      const retry = decodeAiFeatureRetry(remembered, accountId);
      return { kind: 'ready' as const, features: listed.value.features, retry };
    };
    const readProviders = async () => {
      const staff = await staffPrincipal(db, actor, 'AI_SETTINGS_MANAGE');
      return staff.ok ? loadAiProviderSettings(db, actor, staff.value) : null;
    };
    const [features, providers] = await Promise.all([readFeatures(), readProviders()]);
    return { features, providers };
  });

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/admin/settings', label: 'Settings' }}
        eyebrow="Platform Settings"
        title="AI Settings"
        description="Turn each AI feature on or off, set how much each person may use it a day, and manage AI providers, their data terms and AI apps. Everything in VisaStack works without AI."
      />
      {data.features === null && data.providers === null ? <AdminRestricted /> : null}
      {data.features ? (
        <section id="ai-features" aria-labelledby="ai-features-title">
          <h2 className="section-title" id="ai-features-title">
            AI Features
          </h2>
          {data.features.kind === 'unavailable' ? (
            <output className="notice notice-warn">{UNAVAILABLE}</output>
          ) : (
            <>
              <article className="card u-mb-150">
                <h3 className="card-title">What Turning a Feature Off Does</h3>
                <p className="card-body">{WHAT_OFF_DOES}</p>
                <p className="card-body">{PRECEDENCE_NOTE}</p>
              </article>
              {data.features.features.map((feature) => (
                <Feature
                  key={feature.feature}
                  feature={feature}
                  retry={
                    data.features?.kind === 'ready' &&
                    data.features.retry?.feature === feature.feature
                      ? {
                          enabled: data.features.retry.enabled,
                          dailyLimit: data.features.retry.dailyLimit,
                        }
                      : undefined
                  }
                />
              ))}
            </>
          )}
        </section>
      ) : null}
      {data.providers ? (
        <>
          {/* The data rule comes before the providers: when it pauses AI, that is the first thing
              to know (#351). The two cards sit side by side where there is room. */}
          <div className="grid">
            <DataTermsSection data={data.providers} />
            <AiAppsSection data={data.providers} />
          </div>
          <AiProvidersSection data={data.providers} />
        </>
      ) : null}
    </section>
  );
}
