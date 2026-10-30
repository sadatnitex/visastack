import { formatMoney, formatMoneyNumber } from '@visastack/core';
import { AI_FEATURE_KEYS } from '@visastack/core/ai-features';
import { CAPACITY_KEYS, aiEntitlementKey } from '@visastack/core/entitlements';
import { PLANS_UNAVAILABLE, type PlanAdminView, listPlansForAdmin } from '@visastack/services';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { PageHeader, StatusBadge } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { PLAN_FORM_RETRY_COOKIE, decodePlanFormRetry } from '../../../../lib/plan-form-retry';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';
import { PlanForm, RetirePlanForm } from './forms';
import {
  BYTES_PER_MB,
  EDITABLE_CAPACITY_KEYS,
  type PlanFormValues,
  aiFeatureName,
  aiFeatureSummary,
  capacityLabel,
  featureLimitField,
  featureOnField,
  limitField,
  onItWords,
} from './labels';

export const metadata: Metadata = { title: 'Plans' };

export const dynamic = 'force-dynamic';

/** What a plan's form shows before anything is typed. */
function initialValues(plan: PlanAdminView | null): PlanFormValues {
  const values: Record<string, string> = {
    name: plan?.name ?? '',
    periodDays: String(plan?.periodDays ?? 30),
    price: plan?.price
      ? formatMoneyNumber(plan.price.priceMinorUnits, plan.price.currency, { grouping: false })
      : '',
    currency: plan?.price?.currency ?? (plan ? '' : 'BDT'),
  };
  for (const key of CAPACITY_KEYS) {
    const limit = plan?.rules[key]?.limit ?? null;
    values[limitField(key)] =
      limit === null
        ? ''
        : String(key === 'storage_bytes' ? Math.round(limit / BYTES_PER_MB) : limit);
  }
  for (const feature of AI_FEATURE_KEYS) {
    const rule = plan?.rules[aiEntitlementKey(feature)];
    values[featureOnField(feature)] = rule?.included ? 'on' : '';
    values[featureLimitField(feature)] = rule?.limit === null || !rule ? '' : String(rule.limit);
  }
  return values;
}

function priceWords(plan: PlanAdminView): string {
  if (plan.audience === 'TRAVELLER') return 'Free';
  if (!plan.price) return 'No Price';
  return `${formatMoney(plan.price.priceMinorUnits, plan.price.currency)} every ${periodWords(plan.periodDays)}`;
}

/** "30 days", "1 day". */
function periodWords(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

function limitWords(plan: PlanAdminView, key: (typeof CAPACITY_KEYS)[number]): string {
  if (plan.bypassLimits) return 'Unlimited (Complimentary)';
  const limit = plan.rules[key]?.limit ?? null;
  if (limit === null) return 'Unlimited';
  return key === 'storage_bytes' ? `${Math.round(limit / BYTES_PER_MB)} MB` : String(limit);
}

function PlanCard({
  plan,
  available,
  retry,
}: {
  readonly plan: PlanAdminView;
  readonly available: boolean;
  readonly retry: PlanFormValues | undefined;
}) {
  const titleId = `plan-${plan.id}`;
  return (
    <article className="card u-mb-150" aria-labelledby={titleId} id={titleId.concat('-card')}>
      <h2 className="card-title" id={titleId} tabIndex={-1}>
        {plan.name}
      </h2>
      <div className="rows">
        <div className="row">
          <span className="row-key">For</span>
          <span>{plan.audience === 'TRAVELLER' ? 'Travellers' : 'Agencies'}</span>
        </div>
        <div className="row">
          <span className="row-key">Price</span>
          <span>{priceWords(plan)}</span>
        </div>
        <div className="row">
          <span className="row-key">On This Plan</span>
          <span>{onItWords(plan.onIt, plan.audience)}</span>
        </div>
        <div className="row">
          <span className="row-key">Status</span>
          <span>
            <StatusBadge tone={plan.active ? 'success' : 'neutral'}>
              {plan.active ? 'Offered' : 'Retired'}
            </StatusBadge>{' '}
            {plan.bypassLimits ? <StatusBadge tone="success">Complimentary</StatusBadge> : null}
          </span>
        </div>
        {plan.audience === 'TRAVELLER'
          ? null
          : EDITABLE_CAPACITY_KEYS.map((key) => (
              <div className="row" key={key}>
                <span className="row-key">{capacityLabel(key).replace(' (MB)', '')}</span>
                <span>{limitWords(plan, key)}</span>
              </div>
            ))}
        {(plan.audience === 'TRAVELLER' ? AI_FEATURE_KEYS : []).map((feature) => (
          <div className="row" key={feature}>
            <span className="row-key">{aiFeatureName(feature)}</span>
            <span>
              {aiFeatureSummary(
                plan.rules[aiEntitlementKey(feature)] ?? { included: false, limit: null },
              )}
            </span>
          </div>
        ))}
      </div>
      {available ? (
        <>
          <h3 className="card-title">Change {plan.name}</h3>
          <PlanForm
            planId={plan.id}
            planName={plan.name}
            initial={initialValues(plan)}
            periodLocked={plan.periodLocked}
            traveller={plan.audience === 'TRAVELLER'}
            {...(retry ? { retry } : {})}
          />
          {plan.retireBlocked === null || plan.retireBlocked === 'retired' ? (
            <>
              {plan.retireBlocked === null ? (
                <h3 className="card-title">Retire {plan.name}</h3>
              ) : null}
              <RetirePlanForm
                planId={plan.id}
                planName={plan.name}
                headingId={titleId}
                retired={plan.retireBlocked === 'retired'}
              />
            </>
          ) : (
            <p className="muted u-fs-085">
              {plan.retireBlocked === 'traveller'
                ? 'Every traveller is on this plan, so it cannot be retired.'
                : 'Every new agency starts on this plan, so it cannot be retired.'}
            </p>
          )}
        </>
      ) : null}
    </article>
  );
}

/**
 * The platform owner creates plans and sets their limits, AI features and prices, and retires
 * plans (S29). Owner only (`PLANS_MANAGE`); every save needs a fresh sign-in check. Values typed
 * before that check come back only from the signed cookie the save set for this account, never
 * from the address.
 */
export default async function PlansPage() {
  const remembered = (await cookies()).get(PLAN_FORM_RETRY_COOKIE)?.value;
  const data = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PLANS_MANAGE',
    );
    if (!staff.ok) return { kind: 'restricted' as const };
    const listed = await listPlansForAdmin(db, staff.value);
    if (!listed.ok) return { kind: 'restricted' as const };
    return {
      kind: 'ready' as const,
      available: listed.value.available,
      plans: listed.value.plans,
      retry: decodePlanFormRetry(remembered, accountId),
    };
  });

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/admin/settings', label: 'Settings' }}
        eyebrow="Platform Settings"
        title="Plans"
        description="The plans agencies can be put on: what each includes, what it costs and for how long. A new price applies from each agency's next billing period."
      />
      {data.kind === 'restricted' ? (
        <AdminRestricted />
      ) : (
        <>
          {data.available ? null : (
            <output className="notice notice-warn">{PLANS_UNAVAILABLE}</output>
          )}
          {data.plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              available={data.available}
              retry={data.retry?.form === plan.id ? data.retry.fields : undefined}
            />
          ))}
          {data.available ? (
            <article className="card u-mb-150" aria-labelledby="new-plan-title">
              <h2 className="card-title" id="new-plan-title">
                New Plan
              </h2>
              <p className="card-body">
                A new plan is for agencies. Once saved, it can be given to an agency on its
                Organizations page.
              </p>
              <PlanForm
                planName="New Plan"
                initial={initialValues(null)}
                periodLocked={false}
                traveller={false}
                {...(data.retry?.form === 'new' ? { retry: data.retry.fields } : {})}
              />
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}
