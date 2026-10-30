import { isAiFeatureKey } from '@visastack/core/ai-features';
import { type AiFeatureSettingView, listAiFeatureSettings } from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader, StatusBadge } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
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

/** The platform owner turns AI features on or off and sets how much each person may use them. */
/** Values typed before a fresh sign-in check, read back from the return address. */
function retryFrom(
  search: Record<string, string | string[] | undefined>,
): { readonly feature: string; readonly values: AiFeatureValues } | undefined {
  const one = (name: string) => {
    const value = search[name];
    return typeof value === 'string' ? value : undefined;
  };
  const feature = one('retry_feature');
  const limit = one('retry_limit') ?? '';
  if (!feature || !isAiFeatureKey(feature) || !/^\d{0,4}$/.test(limit)) return undefined;
  return { feature, values: { enabled: one('retry_on') === '1', dailyLimit: limit } };
}

export default async function AiFeaturesPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const retry = retryFrom((await searchParams) ?? {});
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
    return { kind: 'ready' as const, features: listed.value.features };
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
              retry={retry?.feature === feature.feature ? retry.values : undefined}
            />
          ))}
        </>
      )}
    </section>
  );
}
