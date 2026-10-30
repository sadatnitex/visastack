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
import { type AiFeatureValues, WHAT_OFF_DOES, limitLine } from './labels';

export const metadata: Metadata = { title: 'AI Features' };

export const dynamic = 'force-dynamic';

const UNAVAILABLE =
  'AI features cannot be changed yet. Until they can, every AI feature listed here stays off, and everything else works as usual.';

function Feature({
  feature,
  retry,
}: {
  readonly feature: AiFeatureSettingView;
  readonly retry: AiFeatureValues | undefined;
}) {
  return (
    <article className="card u-mb-150" aria-labelledby={`ai-feature-${feature.feature}`}>
      <h2 className="card-title" id={`ai-feature-${feature.feature}`}>
        {feature.name}
      </h2>
      <p className="card-body">{feature.description}</p>
      <div className="rows">
        <div className="row">
          <span className="row-key">Now</span>
          <StatusBadge tone={feature.enabled ? 'success' : 'neutral'}>
            {feature.enabled ? 'On' : 'Off'}
          </StatusBadge>
        </div>
        <div className="row">
          <span className="row-key">Daily Limit per Person</span>
          <span>{limitLine(feature.adminDailyLimit, feature.planDailyLimit)}</span>
        </div>
      </div>
      <p className="muted u-fs-085">
        {feature.updatedAt
          ? `Last changed on ${formatTimestamp(feature.updatedAt)}.`
          : 'Never changed: it uses its standard setting.'}
      </p>
      <h3 className="card-title">Change {feature.name}</h3>
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
 * The platform owner turns AI features on or off and sets how much each person may use them.
 * Values typed before a fresh sign-in check come back only from the signed cookie the save set for
 * this account, never from the address.
 */
export default async function AiFeaturesPage() {
  const remembered = (await cookies()).get(AI_FEATURE_RETRY_COOKIE)?.value;
  const data = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'AI_FEATURES_MANAGE',
    );
    if (!staff.ok) return { kind: 'restricted' as const };
    const listed = await listAiFeatureSettings(db, staff.value);
    if (!listed.ok) return { kind: 'restricted' as const };
    if (!listed.value.available) return { kind: 'unavailable' as const };
    const retry = decodeAiFeatureRetry(remembered, accountId);
    return { kind: 'ready' as const, features: listed.value.features, retry };
  });

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/admin/settings', label: 'Settings' }}
        eyebrow="Platform Settings"
        title="AI Features"
        description="Turn each AI feature on or off for everyone, and set how much each person may use it a day."
      />
      {data.kind === 'restricted' ? (
        <AdminRestricted />
      ) : data.kind === 'unavailable' ? (
        <output className="notice notice-warn">{UNAVAILABLE}</output>
      ) : (
        <>
          <article className="card u-mb-150">
            <h2 className="card-title">What Turning a Feature Off Does</h2>
            <p className="card-body">{WHAT_OFF_DOES}</p>
          </article>
          {data.features.map((feature) => (
            <Feature
              key={feature.feature}
              feature={feature}
              retry={
                data.retry?.feature === feature.feature
                  ? { enabled: data.retry.enabled, dailyLimit: data.retry.dailyLimit }
                  : undefined
              }
            />
          ))}
        </>
      )}
    </section>
  );
}
