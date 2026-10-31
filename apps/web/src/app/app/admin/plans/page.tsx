import { formatMoney, formatMoneyNumber } from '@visastack/core';
import {
  AI_AGENCY_FEATURE_KEYS,
  AI_FEATURES,
  AI_FEATURE_KEYS,
  AI_TRAVELLER_FEATURE_KEYS,
  type AiFeatureKey,
} from '@visastack/core/ai-features';
import {
  CAPACITY_KEYS,
  TRAVELLER_STORAGE_ENTITLEMENTS,
  TRAVELLER_STORAGE_KEYS,
  type TravellerStorageKey,
  aiEntitlementKey,
} from '@visastack/core/entitlements';
import {
  PLANS_UNAVAILABLE,
  type PlanAdminView,
  TRAVELLER_PLAN_CURRENCY,
  TRAVELLER_PLAN_KEY,
  listPlansForAdmin,
  loadUploadQuotaConfig,
} from '@visastack/services';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { StickyDetails } from '../../../../components/sticky-details';
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
  type PlanKind,
  TRAVELLER_SELLING_NOTE,
  aiFeatureName,
  aiFeatureSummary,
  capacityLabel,
  featureLimitField,
  featureOnField,
  limitField,
  mbText,
  onItWords,
  travellerFreeStorageNote,
} from './labels';

export const metadata: Metadata = { title: 'Plans' };

export const dynamic = 'force-dynamic';

/** The upload settings a traveller storage rule follows when empty, in bytes. */
interface UploadDefaults {
  readonly accountBytes: number;
  readonly personBytes: number;
}

function kindOf(plan: PlanAdminView): PlanKind {
  if (plan.audience === 'AGENCY') return 'agency';
  return plan.key === TRAVELLER_PLAN_KEY ? 'traveller_free' : 'traveller';
}

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
  for (const key of TRAVELLER_STORAGE_KEYS) {
    const limit = plan?.rules[key]?.limit ?? null;
    values[limitField(key)] = limit === null ? '' : String(Math.round(limit / BYTES_PER_MB));
  }
  for (const key of CAPACITY_KEYS) {
    const limit = plan?.rules[key]?.limit ?? null;
    values[limitField(key)] =
      limit === null
        ? ''
        : String(key === 'storage_bytes' ? Math.round(limit / BYTES_PER_MB) : limit);
  }
  for (const feature of AI_FEATURE_KEYS) {
    const rule = plan ? aiRuleOf(plan, feature) : undefined;
    values[featureOnField(feature)] = rule?.included ? 'on' : '';
    values[featureLimitField(feature)] = rule?.limit === null || !rule ? '' : String(rule.limit);
  }
  return values;
}

/**
 * What the New Traveller Plan form starts with: no name or price, and Traveller Free's own AI
 * rules, so a plan saved as it first appears gives at least what Free gives (ADR 0025 D1).
 */
function newTravellerValues(free: PlanAdminView | undefined): PlanFormValues {
  const values: Record<string, string> = {
    ...initialValues(null),
    currency: TRAVELLER_PLAN_CURRENCY,
  };
  for (const feature of AI_FEATURE_KEYS) {
    const rule = free
      ? aiRuleOf(free, feature)
      : {
          included: AI_FEATURES[feature].planDefault.included,
          limit: AI_FEATURES[feature].planDefault.dailyLimit,
        };
    values[featureOnField(feature)] = rule.included ? 'on' : '';
    values[featureLimitField(feature)] = rule.limit === null ? '' : String(rule.limit);
  }
  return values;
}

/**
 * A plan's rule for one AI feature, or what the resolver gives without one: the registry's plan
 * default (an agency plan has no AI rows until a rule is saved, S22).
 */
function aiRuleOf(
  plan: PlanAdminView,
  feature: AiFeatureKey,
): { readonly included: boolean; readonly limit: number | null } {
  const fallback = AI_FEATURES[feature].planDefault;
  return (
    plan.rules[aiEntitlementKey(feature)] ?? {
      included: fallback.included,
      limit: fallback.dailyLimit,
    }
  );
}

function priceWords(plan: PlanAdminView): string {
  if (plan.key === TRAVELLER_PLAN_KEY) return 'Free';
  if (!plan.price) return plan.audience === 'TRAVELLER' ? 'No Price (Not for Sale)' : 'No Price';
  const money = formatMoney(plan.price.priceMinorUnits, plan.price.currency);
  return plan.audience === 'TRAVELLER'
    ? `${money} for ${periodWords(plan.periodDays)}`
    : `${money} every ${periodWords(plan.periodDays)}`;
}

/** A traveller storage rule: its limit, or the upload setting it follows. */
function storageWords(
  plan: PlanAdminView,
  key: TravellerStorageKey,
  defaults: UploadDefaults,
): string {
  const limit = plan.rules[key]?.limit ?? null;
  if (limit !== null) return mbText(limit);
  const setting = key === 'account_storage_bytes' ? defaults.accountBytes : defaults.personBytes;
  return `Upload Setting (${mbText(setting)})`;
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
  uploadDefaults,
}: {
  readonly plan: PlanAdminView;
  readonly available: boolean;
  readonly retry: PlanFormValues | undefined;
  readonly uploadDefaults: UploadDefaults;
}) {
  const titleId = `plan-${plan.id}`;
  const kind = kindOf(plan);
  return (
    <article className="card u-mb-150" aria-labelledby={titleId} id={titleId.concat('-card')}>
      <h2 className="card-title" id={titleId} tabIndex={-1}>
        {plan.name}
      </h2>
      <div className="rows rows-grid">
        <div className="row">
          <span className="row-key">For</span>
          <span className="row-val">
            {plan.audience === 'TRAVELLER' ? 'Travellers' : 'Agencies'}
          </span>
        </div>
        <div className="row">
          <span className="row-key">Price</span>
          <span className="row-val">{priceWords(plan)}</span>
        </div>
        <div className="row">
          <span className="row-key">On This Plan</span>
          <span className="row-val">{onItWords(plan.onIt, plan.audience)}</span>
        </div>
        <div className="row">
          <span className="row-key">Status</span>
          <span className="row-val">
            {/* A paid traveller plan is not sold until buying is switched on (ADR 0025). */}
            <StatusBadge
              tone={plan.active ? (kind === 'traveller' ? 'warning' : 'success') : 'neutral'}
            >
              {plan.active ? (kind === 'traveller' ? 'Not Sold Yet' : 'Offered') : 'Retired'}
            </StatusBadge>{' '}
            {plan.bypassLimits ? <StatusBadge tone="success">Complimentary</StatusBadge> : null}
          </span>
        </div>
        {plan.audience === 'TRAVELLER'
          ? TRAVELLER_STORAGE_KEYS.map((key) => (
              <div className="row" key={key}>
                <span className="row-key">{TRAVELLER_STORAGE_ENTITLEMENTS[key].name}</span>
                <span className="row-val">{storageWords(plan, key, uploadDefaults)}</span>
              </div>
            ))
          : EDITABLE_CAPACITY_KEYS.map((key) => (
              <div className="row" key={key}>
                <span className="row-key">{capacityLabel(key).replace(' (MB)', '')}</span>
                <span className="row-val">{limitWords(plan, key)}</span>
              </div>
            ))}
        {(plan.audience === 'TRAVELLER' ? AI_TRAVELLER_FEATURE_KEYS : AI_AGENCY_FEATURE_KEYS).map(
          (feature) => (
            <div className="row" key={feature}>
              <span className="row-key">{aiFeatureName(feature)}</span>
              <span className="row-val">{aiFeatureSummary(aiRuleOf(plan, feature))}</span>
            </div>
          ),
        )}
      </div>
      {kind === 'traveller' && plan.active ? (
        <p className="muted u-fs-085 u-mt-100">{TRAVELLER_SELLING_NOTE}</p>
      ) : null}
      {kind === 'traveller_free' ? (
        <p className="muted u-fs-085 u-mt-100">
          {travellerFreeStorageNote(uploadDefaults.accountBytes, uploadDefaults.personBytes)}
        </p>
      ) : null}
      {available ? (
        <>
          {/* Folded, so a page of plans is not a column of open forms; a save that needs
              fixing reopens it with the entered values. */}
          <StickyDetails
            className="disclosure form-more u-mt-100"
            initiallyOpen={retry !== undefined}
            summary={<>Change {plan.name}</>}
          >
            <div className="disclosure-body">
              <PlanForm
                planId={plan.id}
                planName={plan.name}
                initial={initialValues(plan)}
                periodLocked={plan.periodLocked}
                kind={kind}
                uploadDefaults={uploadDefaults}
                {...(retry ? { retry } : {})}
              />
            </div>
          </StickyDetails>
          {plan.retireBlocked === null ? (
            <StickyDetails
              className="disclosure form-more u-mt-100"
              initiallyOpen={false}
              summary={<>Retire {plan.name}</>}
            >
              <div className="disclosure-body">
                <RetirePlanForm
                  planId={plan.id}
                  planName={plan.name}
                  headingId={titleId}
                  retired={false}
                  audience={plan.audience}
                />
              </div>
            </StickyDetails>
          ) : plan.retireBlocked === 'retired' ? (
            <RetirePlanForm
              planId={plan.id}
              planName={plan.name}
              headingId={titleId}
              retired
              audience={plan.audience}
            />
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
    const quota = loadUploadQuotaConfig();
    return {
      kind: 'ready' as const,
      uploadDefaults: {
        accountBytes: quota.maxAccountEvidenceBytes,
        personBytes: quota.maxApplicantEvidenceBytes,
      },
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
        description="The plans for agencies and travellers: what each includes, what it costs and for how long. A new agency price applies from each agency's next billing period."
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
              uploadDefaults={data.uploadDefaults}
            />
          ))}
          {data.available ? (
            <>
              <article className="card u-mb-150" aria-labelledby="new-plan-title">
                <h2 className="card-title" id="new-plan-title">
                  New Agency Plan
                </h2>
                <p className="card-body">
                  Once saved, it can be given to an agency on its Organizations page.
                </p>
                <PlanForm
                  planName="New Agency Plan"
                  initial={initialValues(null)}
                  periodLocked={false}
                  kind="agency"
                  uploadDefaults={data.uploadDefaults}
                  {...(data.retry?.form === 'new' ? { retry: data.retry.fields } : {})}
                />
              </article>
              <article className="card u-mb-150" aria-labelledby="new-traveller-plan-title">
                <h2 className="card-title" id="new-traveller-plan-title">
                  New Traveller Plan
                </h2>
                <p className="card-body">
                  A paid plan travellers buy for themselves and everyone they keep a record for. It
                  gives more room than Traveller Free: more storage and higher daily limits.{' '}
                  {TRAVELLER_SELLING_NOTE}
                </p>
                <PlanForm
                  planName="New Traveller Plan"
                  initial={newTravellerValues(data.plans.find((p) => p.key === TRAVELLER_PLAN_KEY))}
                  periodLocked={false}
                  kind="traveller"
                  uploadDefaults={data.uploadDefaults}
                  {...(data.retry?.form === 'new-traveller' ? { retry: data.retry.fields } : {})}
                />
              </article>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
