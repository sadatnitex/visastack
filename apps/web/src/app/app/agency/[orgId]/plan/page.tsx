import { formatBillingDate, formatMoney } from '@visastack/core';
import { AI_FEATURES, AI_FEATURE_KEYS } from '@visastack/core/ai-features';
import {
  getPendingDowngradeForOrganization,
  getUsageForOrganization,
  listPlans,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../../components/ui';
import { withSession } from '../../../../../lib/session';
import { formatMeterValue, meterFraction, meterTone } from '../../../../../lib/usage-format';
import { BillingStatusNotice, loadBillingNotice } from '../billing-status-notice';
import { loadOrgAccess } from '../console-data';

export const metadata: Metadata = { title: 'Agency Usage and Billing' };

/** What the plan gives for one AI feature, in the page's words (S29). */
function aiFeatureWords(
  entitlement: { readonly included: boolean; readonly dailyLimit: number | null } | undefined,
): string {
  if (!entitlement?.included) return 'Not in Your Plan';
  return entitlement.dailyLimit === null
    ? 'Included'
    : `Included, up to ${entitlement.dailyLimit} a day per person`;
}

export const dynamic = 'force-dynamic';

/**
 * COM-01 (PRD §12 / master directive Part 5 §6): "Show each meter and its
 * definition." Read-only -- this page never gates or alters anything
 * elsewhere in the app; it only displays the entitlement data
 * `getUsageForOrganization` already computes. Plan/subscription management
 * itself (creating plans, activating one for an org) is a platform-owner,
 * step-up-gated action -- see `/app/admin/organizations/[orgId]` (ADM-01).
 *
 * This is the "Usage & Billing" section of the agency console (Part 9 UX-01);
 * the organization header and the section bar come from the console's layout,
 * which also answers for an organization that does not exist.
 */
export default async function OrgPlanPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const usage = await getUsageForOrganization(db, {
      actorAccountId: accountId,
      organizationId: orgId,
    });
    if (!usage.ok) {
      return {
        usage: null,
        error: usage.error.message,
        admin: false,
        status: null,
        downgrade: null,
      };
    }
    // Only after the usage read has shown this person belongs to the agency.
    const [access, status, pending] = await Promise.all([
      loadOrgAccess(db, accountId, orgId),
      loadBillingNotice(db, accountId, orgId),
      getPendingDowngradeForOrganization(db, orgId),
    ]);
    const target = pending
      ? (await listPlans(db)).find((plan) => plan.id === pending.toPlanId)
      : undefined;
    return {
      usage: usage.value,
      error: null,
      admin: access?.admin === true,
      status,
      downgrade: pending ? { on: pending.effectiveAt, planName: target?.name ?? null } : null,
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Usage &amp; Billing"
        title={<>Plan &amp; Usage</>}
        description="Your agency's plan and how much of it is in use. Each limit comes from your plan."
        actions={
          <Link className="btn btn-secondary" href={`/app/agency/${orgId}/plan/invoices`}>
            Invoices
          </Link>
        }
        as="h2"
      />

      <BillingStatusNotice notice={data.status} admin={data.admin} organizationId={orgId} />

      {!data.usage ? (
        <article className="card">
          <p className="card-body">
            {data.error ?? "You don't have access to this organization's plan."}
          </p>
        </article>
      ) : (
        <>
          <article className="card u-mb-150">
            <p className="card-kicker">Current Plan</p>
            <h2 className="card-title">
              {data.usage.plan ? data.usage.plan.name : 'Access Offer Not Recorded'}
            </h2>
            {!data.usage.planAssigned || !data.usage.plan ? (
              <p className="card-body">
                An access offer has not been recorded for this organization. Your measured usage is
                shown below. Record permissions and safety checks still apply.
              </p>
            ) : data.usage.entitlements.bypassLimits ? (
              <p className="card-body">
                Complimentary during public beta. No payment method is required. Fair-use safeguards
                and private-record permissions still apply. Storage and processing remain subject to
                available capacity.
              </p>
            ) : (
              <>
                <p className="card-body">
                  Billing period:{' '}
                  {data.usage.plan.periodDays === 1 ? '1 day' : `${data.usage.plan.periodDays} days`}.{' '}
                  {data.usage.entitlements.plan?.price
                    ? `Price: ${formatMoney(data.usage.entitlements.plan.price.priceMinorUnits, data.usage.entitlements.plan.price.currency)}.`
                    : 'VisaStack has not set a price for this plan yet.'}
                </p>
                {data.usage.entitlements.plan?.nextPrice ? (
                  <p className="notice plan-change-notice">
                    {`From ${formatBillingDate(data.usage.entitlements.plan.nextPrice.from)}, your next billing period, the price is ${formatMoney(data.usage.entitlements.plan.nextPrice.priceMinorUnits, data.usage.entitlements.plan.nextPrice.currency)}. Invoices already made keep their amounts.`}
                  </p>
                ) : null}
              </>
            )}
            {data.downgrade ? (
              <p className="notice plan-change-notice">
                {data.downgrade.planName
                  ? `Your plan changes to ${data.downgrade.planName} on ${formatBillingDate(data.downgrade.on)}.`
                  : `Your plan changes on ${formatBillingDate(data.downgrade.on)}.`}{' '}
                The new limits apply from that day. Nothing is deleted.
              </p>
            ) : null}
          </article>

          <article className="card">
            <p className="card-kicker">What Your Plan Includes</p>
            <h2 className="card-title">Usage</h2>
            <div className="rows u-mt-100">
              {data.usage.meters.map((meter) => (
                <div key={meter.key} className="u-mb-125">
                  <div className="meter-label">
                    <span>{meter.label}</span>
                    <span>{formatMeterValue(meter)}</span>
                  </div>
                  <div className="meter">
                    <div
                      className={`meter-fill ${meterTone(meter)}`.trim()}
                      style={{ width: `${Math.round(meterFraction(meter) * 100)}%` }}
                    />
                  </div>
                  <p
                    className="muted"
                    style={{ fontSize: 'var(--text-small)', marginTop: '0.35rem' }}
                  >
                    {meter.definition}
                    {meter.shownOnly
                      ? ' Shown for your information; it does not stop any work.'
                      : ''}
                  </p>
                </div>
              ))}
            </div>
          </article>

          {/* Agencies have no AI features of their own yet (S22, S28): the resolver answers "not
              applicable" (null), so this section stays away until they do. */}
          {data.usage.entitlements.features ? (
            <article className="card u-mt-150">
              <p className="card-kicker">What Your Plan Includes</p>
              <h2 className="card-title">AI Features</h2>
              <div className="rows">
                {AI_FEATURE_KEYS.map((feature) => {
                  const included = data.usage?.entitlements.features?.[feature];
                  return (
                    <div key={feature} className="row">
                      <span className="row-key">{AI_FEATURES[feature].name}</span>
                      <span>{aiFeatureWords(included)}</span>
                    </div>
                  );
                })}
              </div>
            </article>
          ) : null}
        </>
      )}
    </>
  );
}
